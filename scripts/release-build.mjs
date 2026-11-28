#!/usr/bin/env bun
/**
 * Builds a release on this Mac: the signed Android APK and the `puck` CLI binaries, checked and
 * checksummed in dist/release/<tag>/. It publishes nothing; scripts/publish-release.sh does that.
 *
 *   bun run release:build -- --profile prod    the friend build: prod backend, release key required
 *   bun run release:build -- --profile dev     the same build against the dev backend (debug key unless
 *                                              PUCK_KEYSTORE_PATH is set)
 *
 * Options: --skip-app, --skip-cli, --allow-dirty, --dry-run, --help. Endpoints come from
 * config/profiles.json; the Google web client ID from EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID or
 * app/.env.local. A prod build never falls back to dev: every value must be set, and the built
 * JavaScript bundle must contain the prod Convex host.
 *
 * Signing (Gradle reads these at build time; see app/plugins/withReleaseSigning.js):
 *   PUCK_KEYSTORE_PATH           default ~/.config/puck/release.keystore
 *   PUCK_KEYSTORE_PASSWORD_FILE  default ~/.config/puck/release.keystore.pass (mode 600, one line)
 *   PUCK_KEY_ALIAS               default "puck"
 * The password is read from the file and passed only to the Gradle and keytool child processes.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { androidSdkDir, compareVersions, java17Home, parseBadging } from "../app/scripts/release-install.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "app");
const ANDROID_DIR = join(APP_DIR, "android");
const CLI_DIR = join(ROOT, "cli");
const APK_PATH = join(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk");
const MAPPING_PATH = join(ANDROID_DIR, "app", "build", "outputs", "mapping", "release", "configuration.txt");
const BUNDLE_ENTRY = "assets/index.android.bundle";
const WORK_MANAGER_KEEP = "androidx.work.InputMerger";
const PACKAGE = "in.puckit.app";
const MIN_TARGET_SDK = 36;
const DEV_DEPLOYMENT = "usable-mule-44";
/** One APK carrying both phone ABIs, since a tester's phone is unknown. */
export const ABIS = ["arm64-v8a", "armeabi-v7a"];
/** Keeps versionCodes clear of the 1 that local builds use. */
export const VERSION_CODE_BASE = 1000;
export const CLI_TARGETS = [
  { target: "bun-darwin-arm64", asset: "puck-darwin-arm64" },
  { target: "bun-darwin-x64", asset: "puck-darwin-x64" },
  { target: "bun-linux-x64", asset: "puck-linux-x64" },
];

const USAGE = `Usage: bun run release:build -- --profile <dev|prod> [options]

  --profile <name>  dev or prod (config/profiles.json). Required.
  --skip-app        build only the CLI binaries.
  --skip-cli        build only the APK.
  --allow-dirty     build with uncommitted changes to tracked files (never for a real release).
  --dry-run         check inputs and print the plan; build nothing.
  --help            show this help.

Output: dist/release/<tag>/ with the APK, CLI binaries, SHA256SUMS and notes.md. Nothing is published.`;

/* ------------------------------------------------------------------ pure helpers */

export function parseArgs(argv) {
  const opts = { profile: null, skipApp: false, skipCli: false, allowDirty: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--profile needs a value: dev or prod");
      opts.profile = value;
      i += 1;
    } else if (arg.startsWith("--profile=")) opts.profile = arg.slice("--profile=".length);
    else if (arg === "--skip-app") opts.skipApp = true;
    else if (arg === "--skip-cli") opts.skipCli = true;
    else if (arg === "--allow-dirty") opts.allowDirty = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
  }
  if (opts.help) return opts;
  if (opts.profile !== "dev" && opts.profile !== "prod") throw new Error(`--profile must be dev or prod\n\n${USAGE}`);
  if (opts.skipApp && opts.skipCli) throw new Error("--skip-app and --skip-cli together build nothing");
  return opts;
}

/** One KEY=value from a .env file, unquoted. Returns "" when absent. */
export function envFileValue(text, key) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    return match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return "";
}

function httpsOrigin(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} is not a URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${field} must be https`);
  return url.origin;
}

/**
 * The endpoints for a profile. Prod must name every one of them and must not point at the dev
 * deployment; dev may leave the web client ID empty (sign-in then says so on the phone).
 */
export function resolveProfile(profiles, name, googleWebClientId) {
  const entry = profiles?.[name];
  if (!entry || typeof entry !== "object") throw new Error(`config/profiles.json has no "${name}" profile`);
  const value = (key) => (typeof entry[key] === "string" ? entry[key].trim() : "");
  const resolved = {
    name,
    convexUrl: value("convexUrl"),
    convexSiteUrl: value("convexSiteUrl"),
    clerkFrontendApi: value("clerkFrontendApi"),
    releaseCertSha256: normaliseDigest(value("releaseCertSha256")),
    googleWebClientId: (googleWebClientId ?? "").trim(),
  };
  const missing = [
    ["convexUrl", resolved.convexUrl],
    ["convexSiteUrl", resolved.convexSiteUrl],
    ["clerkFrontendApi", resolved.clerkFrontendApi],
    ...(name === "prod" ? [["EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID", resolved.googleWebClientId]] : []),
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) throw new Error(`The ${name} profile is missing ${missing.join(", ")}`);
  resolved.convexUrl = httpsOrigin(resolved.convexUrl, `${name}.convexUrl`);
  resolved.convexSiteUrl = httpsOrigin(resolved.convexSiteUrl, `${name}.convexSiteUrl`);
  if (!resolved.convexUrl.endsWith(".convex.cloud")) throw new Error(`${name}.convexUrl must be a .convex.cloud URL`);
  if (!resolved.convexSiteUrl.endsWith(".convex.site")) throw new Error(`${name}.convexSiteUrl must be a .convex.site URL`);
  if (hostOf(resolved.convexUrl).split(".")[0] !== hostOf(resolved.convexSiteUrl).split(".")[0]) {
    throw new Error(`${name}.convexUrl and convexSiteUrl name different deployments`);
  }
  if (name === "prod" && hostOf(resolved.convexUrl).startsWith(`${DEV_DEPLOYMENT}.`)) {
    throw new Error("The prod profile points at the dev deployment");
  }
  return resolved;
}

function hostOf(url) {
  return new URL(url).hostname;
}

export function normaliseDigest(text) {
  return text.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

export function versionInfo(appVersion, commitCount, shortSha) {
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new Error(`app.json version must be X.Y.Z, got "${appVersion}"`);
  if (!Number.isInteger(commitCount) || commitCount < 1) throw new Error("commit count must be a positive integer");
  if (!/^[0-9a-f]{7,12}$/.test(shortSha)) throw new Error(`not a short git sha: "${shortSha}"`);
  const versionCode = VERSION_CODE_BASE + commitCount;
  return {
    versionCode,
    versionName: `${appVersion}+${shortSha}`,
    tag: `v${appVersion}-build.${versionCode}`,
    apkAsset: `puck-${appVersion}-build.${versionCode}.apk`,
  };
}

/** Values the CLI release binary bakes in (see cli/src/build.ts). */
export function cliDefines(profile, versionName) {
  const define = (name, value) => ["--define", `${name}=${JSON.stringify(value)}`];
  return [
    ...define("PUCK_BUILD_PROFILE", profile.name),
    ...define("PUCK_BUILD_VERSION", versionName),
    ...define("PUCK_BUILD_DEPLOYMENT_URL", profile.convexUrl),
    ...define("PUCK_BUILD_SITE_URL", profile.convexSiteUrl),
    ...define("PUCK_BUILD_CLERK_FRONTEND_API", profile.clerkFrontendApi),
  ];
}

/** The first signer from `apksigner verify --print-certs`. */
export function parseSigner(text) {
  // Older apksigner prints "Signer #1 certificate ...", newer "V2 Signer: certificate ...".
  const dnText = /(?:Signer #1 certificate|Signer: certificate) DN: (.+)/.exec(text)?.[1]?.trim() ?? null;
  const sha = /(?:Signer #1 certificate|Signer: certificate) SHA-256 digest: ([0-9a-fA-F:]+)/.exec(text)?.[1] ?? null;
  return { dn: dnText, sha256: sha ? normaliseDigest(sha) : null };
}

/** The certificate SHA-256 from `keytool -list -v`. */
export function parseKeytoolSha256(text) {
  const match = /SHA256:\s*([0-9A-Fa-f:]+)/.exec(text);
  return match ? normaliseDigest(match[1]) : null;
}

export function targetSdk(badging) {
  const match = /targetSdkVersion:'(\d+)'/.exec(badging);
  return match ? Number(match[1]) : null;
}

export function colonDigest(hex) {
  return hex.toUpperCase().match(/.{2}/g)?.join(":") ?? "";
}

export function sha256SumsLine(hex, name) {
  return `${hex}  ${name}`;
}

/* ------------------------------------------------------------------ effects */

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function mustRun(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${basename(command)} ${args[0] ?? ""} failed (see the output above).`);
}

function step(message) {
  console.log(`\n==> ${message}`);
}

function git(args) {
  const result = run("git", args, { cwd: ROOT });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function buildTool(sdk, name) {
  const root = join(sdk, "build-tools");
  if (!existsSync(root)) throw new Error(`No build-tools in ${sdk}.`);
  for (const version of readdirSync(root).sort(compareVersions).reverse()) {
    const candidate = join(root, version, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No ${name} under ${root}. Install Android SDK Build-Tools.`);
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readSecretFile(path) {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} must be readable only by you (chmod 600); it is ${mode.toString(8)}`);
  const value = readFileSync(path, "utf8").replace(/\r?\n$/, "");
  if (!value) throw new Error(`${path} is empty`);
  return value;
}

function signingInputs(env, profileName) {
  const dir = join(homedir(), ".config", "puck");
  const keystore = env.PUCK_KEYSTORE_PATH?.trim() || join(dir, "release.keystore");
  const passwordFile = env.PUCK_KEYSTORE_PASSWORD_FILE?.trim() || join(dir, "release.keystore.pass");
  const alias = env.PUCK_KEY_ALIAS?.trim() || "puck";
  const explicit = Boolean(env.PUCK_KEYSTORE_PATH?.trim());
  if (profileName === "dev" && !explicit) return null;
  if (!existsSync(keystore)) {
    throw new Error(`No release keystore at ${keystore}. A ${profileName} build must be signed with the release key.`);
  }
  if (!existsSync(passwordFile)) throw new Error(`No keystore password file at ${passwordFile}.`);
  return { keystore, passwordFile, alias };
}

function keystoreSha256(java, signing) {
  const keytool = join(java, "bin", "keytool");
  const result = run(keytool, [
    "-list",
    "-v",
    "-keystore",
    signing.keystore,
    "-alias",
    signing.alias,
    "-storepass:file",
    signing.passwordFile,
  ]);
  if (result.status !== 0) throw new Error("keytool could not read the release keystore (wrong password or alias?)");
  const digest = parseKeytoolSha256(result.stdout);
  if (!digest) throw new Error("keytool printed no SHA-256 for the release key");
  return digest;
}

function buildApk({ sdk, java, profile, version, signing }) {
  const env = {
    ...process.env,
    JAVA_HOME: java,
    ANDROID_HOME: sdk,
    CI: "1",
    EXPO_PUBLIC_PUCK_PROFILE: profile.name,
    EXPO_PUBLIC_CONVEX_URL: profile.convexUrl,
    EXPO_PUBLIC_CONVEX_SITE_URL: profile.convexSiteUrl,
    EXPO_PUBLIC_CLERK_FRONTEND_API: profile.clerkFrontendApi,
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: profile.googleWebClientId,
    PUCK_VERSION_NAME: version.versionName,
    PUCK_ANDROID_VERSION_CODE: String(version.versionCode),
  };
  delete env.PUCK_KEYSTORE_PATH;
  delete env.PUCK_KEYSTORE_PASSWORD;
  delete env.PUCK_KEY_ALIAS;
  delete env.PUCK_KEY_PASSWORD;
  if (signing) {
    env.PUCK_KEYSTORE_PATH = signing.keystore;
    env.PUCK_KEYSTORE_PASSWORD = readSecretFile(signing.passwordFile);
    env.PUCK_KEY_ALIAS = signing.alias;
  }
  step("Prebuild Android from scratch (expo prebuild --clean)");
  mustRun("node", [join(APP_DIR, "node_modules", "expo", "bin", "cli"), "prebuild", "--platform", "android", "--clean", "--no-install"], {
    cwd: APP_DIR,
    env,
  });
  step(`Gradle assembleRelease (${ABIS.join(" + ")}, R8 on, JavaScript embedded)`);
  rmSync(APK_PATH, { force: true });
  mustRun(join(ANDROID_DIR, "gradlew"), [":app:assembleRelease", `-PreactNativeArchitectures=${ABIS.join(",")}`], {
    cwd: ANDROID_DIR,
    env,
  });
}

function verifyApk({ sdk, java, profile, version, signing }) {
  if (!existsSync(APK_PATH)) throw new Error(`No APK at ${APK_PATH}`);
  const entries = run("unzip", ["-Z1", APK_PATH]).stdout.split("\n");
  if (!entries.includes(BUNDLE_ENTRY)) throw new Error("The APK has no embedded JavaScript bundle");
  for (const abi of ABIS) {
    if (!entries.some((entry) => entry.startsWith(`lib/${abi}/`))) throw new Error(`The APK has no native libraries for ${abi}`);
  }
  const badgingText = run(buildTool(sdk, "aapt2"), ["dump", "badging", APK_PATH]).stdout;
  const info = parseBadging(badgingText);
  if (info.pkg !== PACKAGE) throw new Error(`The APK is for ${info.pkg}, expected ${PACKAGE}`);
  if (info.debuggable) throw new Error("The APK is debuggable");
  if (info.versionCode !== String(version.versionCode)) {
    throw new Error(`versionCode is ${info.versionCode}, expected ${version.versionCode}`);
  }
  if (info.versionName !== version.versionName) throw new Error(`versionName is ${info.versionName}, expected ${version.versionName}`);
  const sdkLevel = targetSdk(badgingText);
  if (sdkLevel === null || sdkLevel < MIN_TARGET_SDK) throw new Error(`targetSdkVersion is ${sdkLevel}, needs ${MIN_TARGET_SDK}+`);
  const mapping = existsSync(MAPPING_PATH) ? readFileSync(MAPPING_PATH, "utf8") : "";
  if (!mapping.includes(WORK_MANAGER_KEEP)) throw new Error("The R8 mapping lacks the WorkManager keep rules");

  // The endpoints really baked into the bundle, not whatever .env.local or a stale cache held.
  const bundle = run("unzip", ["-p", APK_PATH, BUNDLE_ENTRY], { encoding: "latin1" }).stdout;
  for (const host of [hostOf(profile.convexUrl), hostOf(profile.convexSiteUrl), profile.clerkFrontendApi]) {
    if (!bundle.includes(host)) throw new Error(`The JavaScript bundle does not contain ${host}; refusing a build for the wrong backend`);
  }

  const certs = run(buildTool(sdk, "apksigner"), ["verify", "--print-certs", APK_PATH], { env: { ...process.env, JAVA_HOME: java } });
  if (certs.status !== 0) throw new Error(`apksigner verify failed:\n${certs.stderr.trim()}`);
  const signer = parseSigner(certs.stdout);
  if (!signer.sha256) throw new Error("apksigner printed no signer");
  const debugKey = /Android Debug/i.test(signer.dn ?? "");
  if (signing) {
    if (debugKey) throw new Error("The APK is signed with the debug key, not the release key");
    const expected = profile.releaseCertSha256 || keystoreSha256(java, signing);
    if (signer.sha256 !== expected) {
      throw new Error(`The APK's signer ${colonDigest(signer.sha256)} is not the release key ${colonDigest(expected)}`);
    }
  }
  return { ...info, targetSdk: sdkLevel, signerSha256: signer.sha256, debugKey };
}

function buildCli({ profile, version, outDir }) {
  const built = [];
  for (const { target, asset } of CLI_TARGETS) {
    step(`CLI ${asset} (${target}, ${profile.name} defaults)`);
    const outfile = join(outDir, asset);
    mustRun(
      process.execPath,
      ["build", "src/index.ts", "--compile", "--minify", `--target=${target}`, ...cliDefines(profile, version.versionName), "--outfile", outfile],
      { cwd: CLI_DIR },
    );
    built.push(outfile);
  }
  const native = process.platform === "darwin" ? (process.arch === "arm64" ? "puck-darwin-arm64" : "puck-darwin-x64") : null;
  if (native) {
    const line = run(join(outDir, native), ["--version"]).stdout.trim();
    const expected = `${version.versionName} (${profile.name})`;
    if (line !== expected) throw new Error(`${native} --version printed "${line}", expected "${expected}"`);
    console.log(`  ${native} --version: ${line}`);
  }
  return built;
}

function notes({ profile, version, apk, assets }) {
  const lines = [
    `Puck ${version.versionName} (build ${version.versionCode}), ${profile.name} backend.`,
    "",
    "Install: see the README's \"Try Puck\" section. Report problems with the Bug report issue form.",
    "",
  ];
  if (apk) {
    lines.push(
      `Android: \`${version.apkAsset}\` (package ${PACKAGE}, ${ABIS.join(" + ")}, targetSdk ${apk.targetSdk}).`,
      `Signing certificate SHA-256: \`${colonDigest(apk.signerSha256)}\``,
      "",
    );
  }
  lines.push("SHA-256 checksums (also in `SHA256SUMS`):", "", "```", ...assets, "```", "");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ main */

export function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const profiles = JSON.parse(readFileSync(join(ROOT, "config", "profiles.json"), "utf8"));
  const envLocal = existsSync(join(APP_DIR, ".env.local")) ? readFileSync(join(APP_DIR, ".env.local"), "utf8") : "";
  const webClientId =
    env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID?.trim() || envFileValue(envLocal, "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID");
  const profile = resolveProfile(profiles, opts.profile, webClientId);

  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty && !opts.allowDirty) {
    throw new Error("Tracked files have uncommitted changes. Commit first so the build matches its sha (or pass --allow-dirty for a local test).");
  }
  const appVersion = JSON.parse(readFileSync(join(APP_DIR, "app.json"), "utf8")).expo.version;
  const version = versionInfo(appVersion, Number(git(["rev-list", "--count", "HEAD"])), git(["rev-parse", "--short=7", "HEAD"]));
  const outDir = join(ROOT, "dist", "release", version.tag);

  const sdk = opts.skipApp ? null : androidSdkDir(env);
  const java = opts.skipApp ? null : java17Home(env);
  const signing = opts.skipApp ? null : signingInputs(env, profile.name);

  step("Plan");
  console.log(`  profile:      ${profile.name} (${profile.convexUrl}, Clerk ${profile.clerkFrontendApi})`);
  console.log(`  web client:   ${profile.googleWebClientId ? "set" : "not set (sign-in will not work)"}`);
  console.log(`  version:      ${version.versionName}, versionCode ${version.versionCode}, tag ${version.tag}${dirty ? " (DIRTY TREE)" : ""}`);
  console.log(`  app:          ${opts.skipApp ? "skipped" : `prebuild --clean, assembleRelease ${ABIS.join("+")}`}`);
  console.log(`  signing:      ${opts.skipApp ? "-" : signing ? `release key ${signing.keystore} (alias ${signing.alias})` : "debug key"}`);
  console.log(`  cli:          ${opts.skipCli ? "skipped" : CLI_TARGETS.map((t) => t.asset).join(", ")}`);
  console.log(`  output:       ${outDir}`);
  if (opts.dryRun) {
    console.log("\nDry run: nothing was built.");
    return 0;
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const assets = [];
  let apk = null;
  if (!opts.skipApp) {
    buildApk({ sdk, java, profile, version, signing });
    step("Check the APK");
    apk = verifyApk({ sdk, java, profile, version, signing });
    console.log(
      `  ${apk.pkg} ${apk.versionName} (${apk.versionCode}), targetSdk ${apk.targetSdk}, not debuggable, ${ABIS.join("+")}, ` +
        `bundle points at ${hostOf(profile.convexUrl)}, signed by ${apk.debugKey ? "the DEBUG key" : colonDigest(apk.signerSha256)}`,
    );
    const target = join(outDir, version.apkAsset);
    copyFileSync(APK_PATH, target);
    assets.push(target);
  }
  if (!opts.skipCli) assets.push(...buildCli({ profile, version, outDir }));

  step("Checksums");
  const sums = assets.map((path) => sha256SumsLine(fileSha256(path), basename(path)));
  writeFileSync(join(outDir, "SHA256SUMS"), `${sums.join("\n")}\n`);
  writeFileSync(join(outDir, "notes.md"), notes({ profile, version, apk, assets: sums }));
  for (const line of sums) console.log(`  ${line}`);
  console.log(`\nDone: ${outDir}\nNothing was published. To publish (after approval): scripts/publish-release.sh ${version.tag}`);
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
