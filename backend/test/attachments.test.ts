import { describe, expect, test } from "bun:test";
import {
  FILE_NAME_MAX,
  MAX_ATTACHMENT_BYTES,
  assertDistinctStorageIds,
  cleanFileName,
  payloadAttachment,
  reconcileAttachment,
} from "../convex/lib/attachments";

describe("cleanFileName", () => {
  test("keeps a normal name", () => {
    expect(cleanFileName("build-log.txt", "file")).toBe("build-log.txt");
    expect(cleanFileName("Screenshot 2026-11-06 at 10.15.png", "photo")).toBe("Screenshot 2026-11-06 at 10.15.png");
  });

  test("removes path parts, control characters and leading dots", () => {
    expect(cleanFileName("../../etc/passwd", "file")).toBe("etc_passwd");
    expect(cleanFileName("C:\\Users\\me\\a.txt", "file")).toBe("C_Users_me_a.txt");
    expect(cleanFileName("a\u0000b\nc.txt", "file")).toBe("a_b c.txt");
    expect(cleanFileName(".hidden", "file")).toBe("hidden");
  });

  test("collapses whitespace", () => {
    expect(cleanFileName("  my   notes \t.txt ", "file")).toBe("my notes .txt");
  });

  test("falls back when nothing is left", () => {
    expect(cleanFileName("", "file")).toBe("file");
    expect(cleanFileName("   ", "photo")).toBe("photo.jpg");
    expect(cleanFileName("...", "file")).toBe("file");
  });

  test("shortens a long name and keeps the extension", () => {
    const name = cleanFileName(`${"a".repeat(300)}.pdf`, "file");
    expect(name).toHaveLength(FILE_NAME_MAX);
    expect(name.endsWith(".pdf")).toBe(true);
    expect(cleanFileName("b".repeat(300), "file")).toHaveLength(FILE_NAME_MAX);
  });
});

describe("reconcileAttachment", () => {
  const declared = { type: "photo" as const, name: "IMG 1.jpg", mime: "image/jpeg", size: 10 };

  test("records the stored size, not the declared one", () => {
    expect(reconcileAttachment(declared, { size: 2048 }, 0)).toEqual({ ...declared, size: 2048 });
  });

  test("accepts exactly 20 MB and rejects one byte more", () => {
    expect(reconcileAttachment(declared, { size: MAX_ATTACHMENT_BYTES }, 0).size).toBe(MAX_ATTACHMENT_BYTES);
    expect(() => reconcileAttachment(declared, { size: MAX_ATTACHMENT_BYTES + 1 }, 1)).toThrow(
      /attachment 2 is over the 20 MB limit/,
    );
  });

  test("rejects a file that is not in storage", () => {
    expect(() => reconcileAttachment(declared, null, 2)).toThrow(/attachment 3 was not uploaded/);
  });

  test("cleans the name", () => {
    expect(reconcileAttachment({ ...declared, name: "../x.jpg" }, { size: 1 }, 0).name).toBe("x.jpg");
  });
});

describe("assertDistinctStorageIds", () => {
  test("accepts distinct ids and none", () => {
    expect(() => assertDistinctStorageIds([])).not.toThrow();
    expect(() => assertDistinctStorageIds(["a", "b"])).not.toThrow();
  });

  test("rejects a repeat", () => {
    expect(() => assertDistinctStorageIds(["a", "b", "a"])).toThrow(/twice/);
  });
});

describe("payloadAttachment", () => {
  test("has the five payload fields in order", () => {
    const item = payloadAttachment({ type: "file", name: "a.txt", mime: "text/plain", size: 3 }, "https://x.convex.cloud/api/storage/1");
    expect(Object.keys(item)).toEqual(["type", "name", "mime", "size", "url"]);
    expect(item.url).toBe("https://x.convex.cloud/api/storage/1");
  });
});
