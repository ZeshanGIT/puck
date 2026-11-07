#!/usr/bin/env node
/**
 * One command: build the release APK (arm64, JavaScript embedded, R8 on) and install it on the
 * Pixel 7 with `adb install -r`, which keeps the app's data. Run from `app/` or the repo root:
 *
 *   bun run release:install                        the one physical phone attached (must be a Pixel 7)
 *   bun run release:install -- --serial <serial>   pick the phone when more than one is attached
 *   bun run release:install -- --dry-run           check tools and the phone; build and install nothing
 *   bun run release:install -- --skip-build        install the APK already built
 *
 * It never uninstalls, clears data, downgrades, launches the app or changes device settings, and it
 * never installs on an emulator. Set PUCK_DEVICE_MODEL to another model name, or to "" to skip the
 * model check.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID_DIR = join(APP_DIR, "android");
const APK_PATH = join(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk");
const MAPPING_PATH = join(ANDROID_DIR, "app", "build", "outputs", "mapping", "release", "configuration.txt");
const BUNDLE_ENTRY = "assets/index.android.bundle";
/** Kept by plugins/work-manager-proguard-rules.pro; R8 echoes it into the mapping when it applies. */
const WORK_MANAGER_KEEP = "androidx.work.InputMerger";
const ABI = "arm64-v8a";
const DEFAULT_MODEL = "Pixel 7";
const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;

const USAGE = `Usage: bun run release:install [-- options]

  --serial <serial>   install on this phone (also: PUCK_ADB_SERIAL). Required when more than one phone is attached.
  --dry-run           check the JDK, Android SDK and phone; print the plan; build and install nothing.
  --skip-build        install the release APK already built, without running prebuild or Gradle.
  --help              show this help.

Emulators are refused. The phone's model must be PUCK_DEVICE_MODEL (default "${DEFAULT_MODEL}"; set it to "" to skip).
Install is adb install -r only: no uninstall, no data clear, no downgrade.`;

/* ------------------------------------------------------------------ helpers */

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function step(message) {
  console.log(`\n==> ${message}`);
}

function readPackage() {
  const app = JSON.parse(readFileSync(join(APP_DIR, "app.json"), "utf8"));
  const pkg = app.expo?.android?.package;
  if (typeof pkg !== "string" || pkg.length === 0) throw new Error("app.json has no expo.android.package");
  return pkg;
}

/* ------------------------------------------------------------------- options */

export function parseArgs(argv, env = {}) {
  const opts = {
    serial: env.PUCK_ADB_SERIAL || undefined,
    dryRun: false,
    skipBuild: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--serial") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--serial needs a device serial, for example --serial <serial>");
      opts.serial = value;
      i += 1;
    } else if (arg.startsWith("--serial=")) {
      opts.serial = arg.slice("--serial=".length);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--skip-build") {
      opts.skipBuild = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown option ${arg}. Run with --help.`);
    }
  }
  if (opts.serial !== undefined && !SERIAL_PATTERN.test(opts.serial)) {
    throw new Error(`"${opts.serial}" does not look like an adb serial`);
  }
  return opts;
}

/* ------------------------------------------------------------- JDK and SDK */

export function javaMajor(text) {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!match) return null;
  return match[1] === "1" ? Number(match[2]) : Number(match[1]);
}

export function java17Home(env = process.env, os = platform()) {
  const candidates = [];
  if (env.JAVA_HOME) candidates.push(env.JAVA_HOME);
  if (os === "darwin") {
    const found = spawnSync("/usr/libexec/java_home", ["-v", "17"], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) candidates.push(found.stdout.trim());
  }
  for (const home of candidates) {
    const bin = join(home, "bin", "java");
    if (!existsSync(bin)) continue;
    const version = spawnSync(bin, ["-version"], { encoding: "utf8" });
    if (javaMajor(`${version.stdout ?? ""}${version.stderr ?? ""}`) === 17) return home;
  }
  throw new Error(
    "JDK 17 not found. Install JDK 17 and set JAVA_HOME to it (on macOS, `/usr/libexec/java_home -v 17` must print its path).",
  );
}

export function androidSdkDir(env = process.env, os = platform(), home = homedir()) {
  const dir =
    env.ANDROID_HOME ||
    env.ANDROID_SDK_ROOT ||
    (os === "darwin" ? join(home, "Library", "Android", "sdk") : join(home, "Android", "Sdk"));
  if (!existsSync(dir)) throw new Error(`Android SDK not found at ${dir}. Set ANDROID_HOME to your SDK.`);
  return dir;
}

function adbPath(sdk) {
  const bundled = join(sdk, "platform-tools", "adb");
  if (existsSync(bundled)) return bundled;
  const onPath = spawnSync("adb", ["version"], { encoding: "utf8" });
  if (onPath.error) throw new Error("adb not found. Install platform-tools in the Android SDK or put adb on PATH.");
  return "adb";
}

/* ------------------------------------------------------------------ devices */

export function parseDevices(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("List of devices") && !line.startsWith("*"))
    .map((line) => {
      const [serial, state = "", ...details] = line.split(/\s+/);
      return { serial, state, details: details.join(" ") };
    });
}

export function isEmulatorSerial(serial) {
  return serial.startsWith("emulator-");
}

export function selectDevice(devices, requested) {
  if (requested !== undefined) {
    if (isEmulatorSerial(requested)) {
      throw new Error(`${requested} is an emulator. This script installs only on the physical Pixel 7.`);
    }
    const device = devices.find((candidate) => candidate.serial === requested);
    if (!device) throw new Error(`No device with serial ${requested} is connected. Check with: adb devices -l`);
    if (device.state !== "device") {
      throw new Error(
        `${requested} is ${device.state}. Unlock the phone, accept the debugging prompt, then try again.`,
      );
    }
    return device;
  }
  const phones = devices.filter((device) => !isEmulatorSerial(device.serial));
  const ready = phones.filter((device) => device.state === "device");
  if (ready.length === 1) return ready[0];
  if (ready.length === 0) {
    const seen = phones.map((device) => `${device.serial} (${device.state})`).join(", ") || "none";
    throw new Error(
      `No authorized phone is connected (phones seen: ${seen}). Connect the Pixel 7 over wireless debugging or USB, ` +
        "unlock it and accept the debugging prompt. Emulators are never used.",
    );
  }
  const list = ready.map((device) => device.serial).join(", ");
  throw new Error(`More than one phone is connected (${list}). Pass --serial <serial> to choose one.`);
}

function prop(adb, serial, name) {
  return run(adb, ["-s", serial, "shell", "getprop", name]).stdout.trim();
}

export function modelsMatch(actual, expected) {
  const normalise = (value) => value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return normalise(actual) === normalise(expected);
}

/* ------------------------------------------------------------------- build */

export function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function aaptPath(sdk) {
  const root = join(sdk, "build-tools");
  if (!existsSync(root)) throw new Error(`No build-tools in ${sdk}. Install Android SDK Build-Tools.`);
  const versions = readdirSync(root).sort(compareVersions).reverse();
  for (const version of versions) {
    for (const tool of ["aapt2", "aapt"]) {
      const candidate = join(root, version, tool);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`No aapt2 or aapt found under ${root}. Install Android SDK Build-Tools.`);
}

function buildRelease(sdk, java) {
  const env = { ...process.env, JAVA_HOME: java, ANDROID_HOME: sdk };
  step("Prebuild Android (regenerates app/android from app.json and the config plugins)");
  const prebuild = spawnSync(
    "node",
    [join(APP_DIR, "node_modules", "expo", "bin", "cli"), "prebuild", "--platform", "android", "--no-install"],
    { cwd: APP_DIR, env, stdio: "inherit" },
  );
  if (prebuild.status !== 0) throw new Error("expo prebuild failed (see the output above).");

  step(`Gradle assembleRelease (${ABI}, R8 on, JavaScript embedded)`);
  const gradle = spawnSync(join(ANDROID_DIR, "gradlew"), [":app:assembleRelease", `-PreactNativeArchitectures=${ABI}`], {
    cwd: ANDROID_DIR,
    env,
    stdio: "inherit",
  });
  if (gradle.status !== 0) throw new Error("Gradle assembleRelease failed (see the output above).");
}

export function parseBadging(text) {
  return {
    pkg: /package: name='([^']+)'/.exec(text)?.[1] ?? null,
    versionCode: /versionCode='([^']*)'/.exec(text)?.[1] ?? null,
    versionName: /versionName='([^']*)'/.exec(text)?.[1] ?? null,
    debuggable: /application-debuggable/.test(text),
  };
}

function verifyApk(sdk, pkg) {
  if (!existsSync(APK_PATH)) {
    throw new Error(`No release APK at ${APK_PATH}. Run without --skip-build to build it.`);
  }
  const entries = run("unzip", ["-Z1", APK_PATH]).stdout.split("\n");
  if (!entries.includes(BUNDLE_ENTRY)) {
    throw new Error(`The APK has no embedded JavaScript (${BUNDLE_ENTRY}). Not installing.`);
  }
  const info = parseBadging(run(aaptPath(sdk), ["dump", "badging", APK_PATH]).stdout);
  if (info.pkg !== pkg) throw new Error(`The APK is for ${info.pkg}, expected ${pkg}. Not installing.`);
  if (info.debuggable) throw new Error("The APK is debuggable. A release build must not be. Not installing.");
  const mapping = existsSync(MAPPING_PATH) ? readFileSync(MAPPING_PATH, "utf8") : "";
  if (!mapping.includes(WORK_MANAGER_KEEP)) {
    throw new Error(
      `The R8 mapping does not show the WorkManager keep rules (${WORK_MANAGER_KEEP}). A release without them crashes at startup. Not installing.`,
    );
  }
  return info;
}

/* ------------------------------------------------------------------ install */

export function installArgs(serial, apk) {
  return ["-s", serial, "install", "-r", apk];
}

export function installHint(output) {
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(output)) {
    return "The installed app is signed with a different key, so it cannot be updated in place. Nothing was uninstalled and the data is intact. Ask before changing the signing key or uninstalling.";
  }
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/.test(output)) {
    return "This APK's version code is lower than the installed app's. The script never downgrades. Raise the Android version code first.";
  }
  if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/.test(output)) return "The phone is out of storage. Free space and run again.";
  return "";
}

function reportInstalled(adb, serial, pkg) {
  const dump = run(adb, ["-s", serial, "shell", "dumpsys", "package", pkg]).stdout;
  const pick = (pattern) => pattern.exec(dump)?.[1] ?? "unknown";
  const pathOut = run(adb, ["-s", serial, "shell", "pm", "path", pkg]).stdout.trim();
  console.log(`  versionName:    ${pick(/versionName=(\S+)/)}`);
  console.log(`  versionCode:   ${pick(/versionCode=(\d+)/)}`);
  console.log(`  lastUpdateTime: ${pick(/lastUpdateTime=(.+)/)}`);
  console.log(`  debuggable:     ${/flags=\[[^\]]*DEBUGGABLE/.test(dump) ? "YES (unexpected)" : "no"}`);
  console.log(`  pm path:        ${pathOut || "unknown"}`);
}

/* ---------------------------------------------------------------- main flow */

export function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv, env);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const pkg = readPackage();
  const sdk = androidSdkDir(env);
  const java = java17Home(env);
  const adb = adbPath(sdk);

  const listing = run(adb, ["devices", "-l"]);
  if (listing.status !== 0) throw new Error(`adb devices failed:\n${listing.stderr.trim()}`);
  const device = selectDevice(parseDevices(listing.stdout), opts.serial);

  const model = prop(adb, device.serial, "ro.product.model");
  if (prop(adb, device.serial, "ro.kernel.qemu") === "1") {
    throw new Error(`${device.serial} is an emulator. This script installs only on the physical Pixel 7.`);
  }
  const expectedModel = env.PUCK_DEVICE_MODEL ?? DEFAULT_MODEL;
  if (expectedModel !== "" && !modelsMatch(model, expectedModel)) {
    throw new Error(
      `${device.serial} reports the model "${model || "unknown"}", not "${expectedModel}". ` +
        "Pass --serial for the Pixel 7, or set PUCK_DEVICE_MODEL if this phone is the right one.",
    );
  }

  step("Plan");
  console.log(`  app:      ${APP_DIR}`);
  console.log(`  JDK 17:   ${java}`);
  console.log(`  SDK:      ${sdk}`);
  console.log(`  phone:    ${device.serial} (model "${model}")`);
  console.log(`  package:  ${pkg}`);
  console.log(`  build:    ${opts.skipBuild ? "skipped (--skip-build)" : `prebuild, then assembleRelease ${ABI}`}`);
  console.log(`  APK:      ${APK_PATH}`);
  console.log(`  install:  adb -s ${device.serial} install -r <apk>  (data kept; no uninstall, no downgrade)`);

  if (opts.dryRun) {
    console.log("\nDry run: nothing was built or installed.");
    return 0;
  }

  if (!opts.skipBuild) buildRelease(sdk, java);

  step("Check the APK");
  const info = verifyApk(sdk, pkg);
  console.log(`  ${info.pkg} ${info.versionName} (${info.versionCode}): not debuggable, JavaScript embedded, WorkManager keep rules present`);

  step(`Install on ${device.serial} with adb install -r`);
  const install = run(adb, installArgs(device.serial, APK_PATH));
  const output = `${install.stdout}${install.stderr}`;
  if (!/^Success$/m.test(output)) {
    const hint = installHint(output);
    throw new Error(`adb install -r failed on ${device.serial}:\n${output.trim()}${hint ? `\n\n${hint}` : ""}`);
  }
  console.log("  Success");

  step("Installed package (metadata only; the app is not launched)");
  reportInstalled(adb, device.serial, pkg);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`\nerror: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
