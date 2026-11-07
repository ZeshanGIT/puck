import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  installArgs,
  installHint,
  isEmulatorSerial,
  javaMajor,
  modelsMatch,
  parseArgs,
  parseBadging,
  parseDevices,
  selectDevice,
} from "./release-install.mjs";

const PIXEL = "adb-34271FDH20046C-SniT46._adb-tls-connect._tcp";
const EMULATOR = "emulator-5554";
const LISTING = `List of devices attached
${PIXEL}          device product:panther_beta model:Pixel_7 device:panther transport_id:3
${EMULATOR}          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
R5CT123ABC           unauthorized usb:1-1 transport_id:4
`;

describe("parseDevices", () => {
  test("reads serial, state and details, skipping the header", () => {
    const devices = parseDevices(LISTING);
    expect(devices.map((d) => [d.serial, d.state])).toEqual([
      [PIXEL, "device"],
      [EMULATOR, "device"],
      ["R5CT123ABC", "unauthorized"],
    ]);
    expect(devices[0].details).toContain("model:Pixel_7");
  });

  test("ignores daemon start-up lines and empty output", () => {
    expect(parseDevices("* daemon not running; starting now\n* daemon started successfully\nList of devices attached\n\n")).toEqual([]);
  });
});

describe("selectDevice", () => {
  test("picks the one physical phone and ignores the emulator", () => {
    expect(selectDevice(parseDevices(LISTING), undefined).serial).toBe(PIXEL);
  });

  test("refuses when no authorized phone is connected and says emulators are never used", () => {
    const devices = parseDevices(`List of devices attached\n${EMULATOR}\tdevice\nR5CT123ABC\tunauthorized\n`);
    expect(() => selectDevice(devices, undefined)).toThrow(/No authorized phone is connected.*R5CT123ABC \(unauthorized\).*Emulators are never used/);
  });

  test("refuses when several phones are connected and asks for --serial", () => {
    const devices = parseDevices(`List of devices attached\n${PIXEL}\tdevice\nOTHER123\tdevice\n`);
    expect(() => selectDevice(devices, undefined)).toThrow(/More than one phone.*--serial/);
  });

  test("uses an explicit serial when it is authorized", () => {
    expect(selectDevice(parseDevices(LISTING), PIXEL).serial).toBe(PIXEL);
  });

  test("refuses an explicit emulator serial", () => {
    expect(() => selectDevice(parseDevices(LISTING), EMULATOR)).toThrow(/is an emulator/);
  });

  test("refuses an explicit serial that is not connected", () => {
    expect(() => selectDevice(parseDevices(LISTING), "NOPE")).toThrow(/No device with serial NOPE/);
  });

  test("refuses an explicit serial that is not authorized", () => {
    expect(() => selectDevice(parseDevices(LISTING), "R5CT123ABC")).toThrow(/is unauthorized/);
  });

  test("recognises emulator serials", () => {
    expect(isEmulatorSerial(EMULATOR)).toBe(true);
    expect(isEmulatorSerial(PIXEL)).toBe(false);
  });
});

describe("parseArgs", () => {
  test("defaults to a full build and install", () => {
    expect(parseArgs([], {})).toEqual({ serial: undefined, dryRun: false, skipBuild: false, help: false });
  });

  test("takes --serial in both forms and skips the separator bun forwards", () => {
    expect(parseArgs(["--", "--serial", PIXEL], {}).serial).toBe(PIXEL);
    expect(parseArgs([`--serial=${PIXEL}`], {}).serial).toBe(PIXEL);
  });

  test("reads PUCK_ADB_SERIAL when no flag is given, and the flag wins", () => {
    expect(parseArgs([], { PUCK_ADB_SERIAL: PIXEL }).serial).toBe(PIXEL);
    expect(parseArgs(["--serial", "OTHER"], { PUCK_ADB_SERIAL: PIXEL }).serial).toBe("OTHER");
  });

  test("parses --dry-run, --skip-build and --help", () => {
    expect(parseArgs(["--dry-run", "--skip-build"], {})).toMatchObject({ dryRun: true, skipBuild: true });
    expect(parseArgs(["--help"], {}).help).toBe(true);
  });

  test("rejects unknown options, a missing serial value and odd serials", () => {
    expect(() => parseArgs(["--uninstall"], {})).toThrow(/Unknown option --uninstall/);
    expect(() => parseArgs(["--serial"], {})).toThrow(/needs a device serial/);
    expect(() => parseArgs(["--serial", "--dry-run"], {})).toThrow(/needs a device serial/);
    expect(() => parseArgs(["--serial", "a b"], {})).toThrow(/does not look like an adb serial/);
  });
});

describe("modelsMatch", () => {
  test("accepts the adb property form and the product name", () => {
    expect(modelsMatch("Pixel 7", "Pixel 7")).toBe(true);
    expect(modelsMatch("Pixel_7\n", "pixel 7")).toBe(true);
  });

  test("rejects another phone and an emulator", () => {
    expect(modelsMatch("Pixel 8", "Pixel 7")).toBe(false);
    expect(modelsMatch("sdk_gphone64_arm64", "Pixel 7")).toBe(false);
  });
});

describe("javaMajor", () => {
  test("reads JDK 17 and older Java 8 version strings", () => {
    expect(javaMajor('openjdk version "17.0.14" 2025-01-21')).toBe(17);
    expect(javaMajor('java version "1.8.0_402"')).toBe(8);
    expect(javaMajor("no version here")).toBeNull();
  });
});

describe("compareVersions", () => {
  test("orders build-tools versions numerically", () => {
    expect(["36.0.0", "37.0.0", "9.0.0"].sort(compareVersions)).toEqual(["9.0.0", "36.0.0", "37.0.0"]);
  });
});

describe("parseBadging", () => {
  test("reads the package, versions and debuggable flag from aapt output", () => {
    const text = "package: name='in.puckit.app' versionCode='1' versionName='1.0.0' platformBuildVersionName='17'\nlaunchable-activity: name='in.puckit.app.MainActivity'";
    expect(parseBadging(text)).toEqual({ pkg: "in.puckit.app", versionCode: "1", versionName: "1.0.0", debuggable: false });
    expect(parseBadging(`${text}\napplication-debuggable`).debuggable).toBe(true);
  });
});

describe("installArgs", () => {
  test("is adb -s <serial> install -r <apk>, and never uninstalls, clears, downgrades or tests", () => {
    const args = installArgs(PIXEL, "/tmp/app-release.apk");
    expect(args).toEqual(["-s", PIXEL, "install", "-r", "/tmp/app-release.apk"]);
    for (const forbidden of ["-d", "-t", "uninstall", "clear", "-g"]) expect(args).not.toContain(forbidden);
  });
});

describe("installHint", () => {
  test("explains a signature mismatch without suggesting an uninstall", () => {
    const hint = installHint("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]");
    expect(hint).toMatch(/Nothing was uninstalled/);
    expect(hint).not.toMatch(/run uninstall|adb uninstall/i);
  });

  test("explains a downgrade and a full phone, and is empty otherwise", () => {
    expect(installHint("INSTALL_FAILED_VERSION_DOWNGRADE")).toMatch(/never downgrades/);
    expect(installHint("INSTALL_FAILED_INSUFFICIENT_STORAGE")).toMatch(/out of storage/);
    expect(installHint("Failure [something else]")).toBe("");
  });
});
