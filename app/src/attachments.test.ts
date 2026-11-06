import { describe, expect, test } from "bun:test";
import {
  MAX_ATTACHMENT_BYTES,
  REPLY_MAX,
  admitFiles,
  canSend,
  formatBytes,
  fullMessage,
  pickedFile,
  replyText,
  sizeMessage,
  storageIdFrom,
  withDictation,
  type PickedFile,
} from "./attachments";

function file(name: string, size: number | null, type: "photo" | "file" = "file"): PickedFile {
  return { uri: `file:///cache/${name}`, type, name, mime: "text/plain", size };
}

describe("formatBytes", () => {
  test("uses B, KB and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(18 * 1024)).toBe("18 KB");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe("20 MB");
    expect(formatBytes(-1)).toBe("");
  });
});

describe("pickedFile", () => {
  test("keeps what the picker gave", () => {
    expect(pickedFile("file", { uri: "u", name: "build-log.txt", mimeType: "text/plain", size: 18_000 })).toEqual({
      uri: "u",
      type: "file",
      name: "build-log.txt",
      mime: "text/plain",
      size: 18_000,
    });
  });

  test("fills a missing photo name, media type and size", () => {
    const photo = pickedFile("photo", { uri: "u", name: null, mimeType: undefined }, Date.UTC(2026, 10, 6, 10, 15, 30));
    expect(photo.name).toBe("photo-20261106-101530.jpg");
    expect(photo.mime).toBe("image/jpeg");
    expect(photo.size).toBeNull();
  });

  test("falls back for a file with no usable media type", () => {
    const item = pickedFile("file", { uri: "u", name: " ", mimeType: "weird", size: -4 });
    expect(item.mime).toBe("application/octet-stream");
    expect(item.name).toBe("file");
    expect(item.size).toBeNull();
  });
});

describe("limits", () => {
  test("20 MB is allowed, one byte more is not", () => {
    expect(sizeMessage("a.bin", MAX_ATTACHMENT_BYTES)).toBeNull();
    expect(sizeMessage("a.bin", MAX_ATTACHMENT_BYTES + 1)).toMatch(/a\.bin is 20 MB\. Files can be up to 20 MB\./);
    expect(sizeMessage("a.bin", null)).toBeNull();
  });

  test("a full reply takes no more", () => {
    expect(fullMessage(4)).toBeNull();
    expect(fullMessage(5)).toBe("Up to 5 files per reply");
  });

  test("admitFiles drops oversize files and says why", () => {
    const result = admitFiles([file("big", MAX_ATTACHMENT_BYTES + 1), file("ok", 10)], 0);
    expect(result.kept.map((f) => f.name)).toEqual(["ok"]);
    expect(result.message).toMatch(/big is/);
  });

  test("admitFiles stops at five in all", () => {
    const six = Array.from({ length: 6 }, (_, i) => file(`f${i}`, 1));
    const result = admitFiles(six, 2);
    expect(result.kept.map((f) => f.name)).toEqual(["f0", "f1", "f2"]);
    expect(result.message).toBe("Only the first 3 fit. Up to 5 files per reply.");
  });

  test("admitFiles on a full reply keeps nothing", () => {
    expect(admitFiles([file("a", 1)], 5)).toEqual({ kept: [], message: "Up to 5 files per reply" });
  });

  test("admitFiles with room and no problems says nothing", () => {
    expect(admitFiles([file("a", 1), file("b", 2)], 3)).toEqual({ kept: [file("a", 1), file("b", 2)], message: null });
  });
});

describe("replyText", () => {
  test("turns line breaks into spaces and trims", () => {
    expect(replyText("  Ship it,\n\nbut skip the email \r\n ")).toBe("Ship it, but skip the email");
  });

  test("caps at the backend limit", () => {
    expect(replyText("a".repeat(REPLY_MAX + 50))).toHaveLength(REPLY_MAX);
  });
});

describe("withDictation", () => {
  test("appends heard words after what was typed", () => {
    expect(withDictation("Ship it", "but skip the changelog")).toBe("Ship it but skip the changelog");
    expect(withDictation("Ship it, ", "but")).toBe("Ship it, but");
  });

  test("starts the field when it was empty and keeps it when nothing was heard", () => {
    expect(withDictation("", " hello ")).toBe("hello");
    expect(withDictation("typed", "  ")).toBe("typed");
  });
});

describe("canSend", () => {
  const base = { text: "", attachments: 0, hasOption: false, uploading: false, failed: false };

  test("empty is disabled", () => {
    expect(canSend(base)).toBe(false);
    expect(canSend({ ...base, text: "  \n " })).toBe(false);
  });

  test("words, a file or an option enable it", () => {
    expect(canSend({ ...base, text: "hi" })).toBe(true);
    expect(canSend({ ...base, attachments: 1 })).toBe(true);
    expect(canSend({ ...base, hasOption: true })).toBe(true);
  });

  test("uploading or a failed upload disables it", () => {
    expect(canSend({ ...base, text: "hi", uploading: true })).toBe(false);
    expect(canSend({ ...base, text: "hi", failed: true })).toBe(false);
  });
});

describe("storageIdFrom", () => {
  test("reads the id from Convex's reply", () => {
    expect(storageIdFrom({ storageId: "kg2abc" })).toBe("kg2abc");
    expect(storageIdFrom({ storageId: "" })).toBeNull();
    expect(storageIdFrom({})).toBeNull();
    expect(storageIdFrom(null)).toBeNull();
    expect(storageIdFrom("x")).toBeNull();
  });
});
