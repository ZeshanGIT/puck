import { describe, expect, test } from "bun:test";
import {
  cliDefines,
  colonDigest,
  envFileValue,
  parseArgs,
  parseKeytoolSha256,
  parseSigner,
  resolveProfile,
  targetSdk,
  versionInfo,
} from "./release-build.mjs";

const PROFILES = {
  dev: {
    convexUrl: "https://usable-mule-44.convex.cloud",
    convexSiteUrl: "https://usable-mule-44.convex.site",
    clerkFrontendApi: "in-lemming-9901.clerk.accounts.dev",
  },
  prod: {
    convexUrl: "https://happy-otter-123.convex.cloud/",
    convexSiteUrl: "https://happy-otter-123.convex.site",
    clerkFrontendApi: "in-lemming-9901.clerk.accounts.dev",
    releaseCertSha256: "AB:CD:EF",
  },
};
const WEB = "123-abc.apps.googleusercontent.com";

describe("parseArgs", () => {
  test("needs a dev or prod profile", () => {
    expect(() => parseArgs([])).toThrow("--profile must be dev or prod");
    expect(() => parseArgs(["--profile", "staging"])).toThrow("--profile must be dev or prod");
    expect(parseArgs(["--profile", "prod"]).profile).toBe("prod");
    expect(parseArgs(["--profile=dev", "--skip-app"])).toMatchObject({ profile: "dev", skipApp: true });
  });
  test("rejects unknown options and empty builds", () => {
    expect(() => parseArgs(["--profile", "dev", "--publish"])).toThrow("Unknown option: --publish");
    expect(() => parseArgs(["--profile", "dev", "--skip-app", "--skip-cli"])).toThrow("build nothing");
  });
  test("help needs no profile", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("envFileValue", () => {
  test("reads one key, unquoted, ignoring others", () => {
    const text = "# comment\nOTHER=1\nexport EXPO_PUBLIC_X=\"value-1\"\n";
    expect(envFileValue(text, "EXPO_PUBLIC_X")).toBe("value-1");
    expect(envFileValue(text, "MISSING")).toBe("");
  });
});

describe("resolveProfile", () => {
  test("prod resolves every endpoint", () => {
    expect(resolveProfile(PROFILES, "prod", WEB)).toEqual({
      name: "prod",
      convexUrl: "https://happy-otter-123.convex.cloud",
      convexSiteUrl: "https://happy-otter-123.convex.site",
      clerkFrontendApi: "in-lemming-9901.clerk.accounts.dev",
      releaseCertSha256: "abcdef",
      googleWebClientId: WEB,
    });
  });
  test("prod never falls back: an empty value stops the build", () => {
    expect(() => resolveProfile({ prod: { ...PROFILES.prod, convexUrl: "" } }, "prod", WEB)).toThrow("missing convexUrl");
    expect(() => resolveProfile(PROFILES, "prod", "")).toThrow("missing EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID");
  });
  test("prod refuses the dev deployment and mismatched URLs", () => {
    expect(() => resolveProfile({ prod: { ...PROFILES.dev } }, "prod", WEB)).toThrow("points at the dev deployment");
    expect(() =>
      resolveProfile({ prod: { ...PROFILES.prod, convexSiteUrl: "https://other-cat-9.convex.site" } }, "prod", WEB),
    ).toThrow("different deployments");
    expect(() => resolveProfile({ prod: { ...PROFILES.prod, convexUrl: "http://x.convex.cloud" } }, "prod", WEB)).toThrow(
      "must be https",
    );
  });
  test("dev may build without the web client ID", () => {
    expect(resolveProfile(PROFILES, "dev", "").googleWebClientId).toBe("");
  });
  test("an unknown profile is an error", () => {
    expect(() => resolveProfile(PROFILES, "staging", WEB)).toThrow('no "staging" profile');
  });
});

describe("versionInfo", () => {
  test("versionCode rises with the commit count and clears local builds", () => {
    expect(versionInfo("1.0.0", 42, "abc1234")).toEqual({
      versionCode: 1042,
      versionName: "1.0.0+abc1234",
      tag: "v1.0.0-build.1042",
      apkAsset: "puck-1.0.0-build.1042.apk",
    });
  });
  test("rejects malformed input", () => {
    expect(() => versionInfo("1.0", 1, "abc1234")).toThrow("X.Y.Z");
    expect(() => versionInfo("1.0.0", 0, "abc1234")).toThrow("positive");
    expect(() => versionInfo("1.0.0", 1, "nope")).toThrow("short git sha");
  });
});

describe("cliDefines", () => {
  test("bakes the profile as JSON string literals", () => {
    const args = cliDefines(resolveProfile(PROFILES, "prod", WEB), "1.0.0+abc1234");
    expect(args).toContain('PUCK_BUILD_PROFILE="prod"');
    expect(args).toContain('PUCK_BUILD_DEPLOYMENT_URL="https://happy-otter-123.convex.cloud"');
    expect(args).toContain('PUCK_BUILD_VERSION="1.0.0+abc1234"');
    expect(args.filter((a) => a === "--define")).toHaveLength(5);
  });
});

describe("tool output parsing", () => {
  test("apksigner signer", () => {
    const text = "Signer #1 certificate DN: CN=Android Debug, O=Android, C=US\nSigner #1 certificate SHA-256 digest: aa11bb22\n";
    expect(parseSigner(text)).toEqual({ dn: "CN=Android Debug, O=Android, C=US", sha256: "aa11bb22" });
  });
  test("apksigner signer, newer output", () => {
    const text = "V2 Signer: certificate DN: CN=Puck, O=puckit.in\nV2 Signer: certificate SHA-256 digest: aa11bb22\nV2 Signer: certificate SHA-1 digest: 00\n";
    expect(parseSigner(text)).toEqual({ dn: "CN=Puck, O=puckit.in", sha256: "aa11bb22" });
  });
  test("keytool SHA-256", () => {
    expect(parseKeytoolSha256("Certificate fingerprints:\n\t SHA1: 00:11\n\t SHA256: AA:11:BB:22\n")).toBe("aa11bb22");
  });
  test("targetSdk and digests", () => {
    expect(targetSdk("sdkVersion:'24'\ntargetSdkVersion:'36'\n")).toBe(36);
    expect(colonDigest("aa11bb")).toBe("AA:11:BB");
  });
});

describe("notes", () => {
  test("first line keeps the shape publish-release.sh parses, and the install command is included", async () => {
    const { notes } = await import("./release-build.mjs");
    const version = versionInfo("1.0.0", 180, "abc1234");
    const text = notes({
      profile: { name: "prod" },
      version,
      apk: { targetSdk: 36, signerSha256: "b27d" },
      assets: ["aa  puck-1.0.0-build.1180.apk"],
    });
    const first = text.split("\n")[0];
    expect(first).toBe("Puck 1.0.0+abc1234 (build 1180), prod backend.");
    expect(/^Puck [0-9.]*\+([0-9a-f]*) /.exec(first)?.[1]).toBe("abc1234");
    expect(text).toContain("install.sh | sh");
    expect(text).toContain("puck-1.0.0-build.1180.apk");
    expect(text).toContain("B2:7D");
    expect(text).toContain("## Known gaps");
  });
});
