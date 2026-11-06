/**
 * Reply attachments on the phone: pick (camera, photo library, file), check the limits, and
 * upload to Convex file storage (Protocol changes sections 2 to 4).
 *
 * The pure helpers (names, sizes, limits, messages) have no native imports so `bun test` can load
 * this file. The pickers load their Expo modules when used. `expo-file-system` is not installed,
 * so a picked file is read with `fetch(uri).blob()` and sent with `XMLHttpRequest` (for progress).
 */
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type AttachmentType } from "@puck/shared";

export { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES };

/** The reply text limit, the same as `validateAnswer`'s `customReply`. */
export const REPLY_MAX = 2_000;

const MAX_MB = MAX_ATTACHMENT_BYTES / (1024 * 1024);

/** A file the person picked or took, not yet uploaded. `size` is null when the picker did not know it. */
export interface PickedFile {
  uri: string;
  type: AttachmentType;
  name: string;
  mime: string;
  size: number | null;
}

/** An uploaded file: the Convex storage id and its metadata, in the shape `answers.record` takes. */
export interface UploadedAttachment {
  storageId: string;
  type: AttachmentType;
  name: string;
  mime: string;
  size: number;
}

export type PickResult =
  | { status: "ok"; files: PickedFile[] }
  | { status: "cancelled" }
  | { status: "denied"; message: string };

/** "18 KB", "1.2 MB". Whole numbers for bytes and KB, one decimal from MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** How many more files fit in the reply. */
export function roomLeft(count: number): number {
  return Math.max(0, MAX_ATTACHMENTS - count);
}

/** The message when the reply already has the most files, else null. */
export function fullMessage(count: number): string | null {
  return roomLeft(count) === 0 ? `Up to ${MAX_ATTACHMENTS} files per reply` : null;
}

/** The message when `size` bytes is over the limit, else null. */
export function sizeMessage(name: string, size: number | null): string | null {
  if (size === null || size <= MAX_ATTACHMENT_BYTES) return null;
  return `${name} is ${formatBytes(size)}. Files can be up to ${MAX_MB} MB.`;
}

/** The message for files that did not fit when several were picked, else null. */
export function skippedMessage(picked: number, kept: number): string | null {
  if (kept >= picked) return null;
  return `Only the first ${kept} fit. Up to ${MAX_ATTACHMENTS} files per reply.`;
}

/** A timestamped name for a photo that arrived without one. */
function photoName(now: number, mime: string): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/heic" ? "heic" : "jpg";
  return `photo-${stamp}.${ext}`;
}

/** Normalise what a picker returned: a name and media type are always set. */
export function pickedFile(
  type: AttachmentType,
  asset: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null },
  now: number = Date.now(),
): PickedFile {
  const mime =
    asset.mimeType && /^[^/\s]+\/[^/\s]+$/.test(asset.mimeType)
      ? asset.mimeType
      : type === "photo"
        ? "image/jpeg"
        : "application/octet-stream";
  const name = asset.name?.trim() || (type === "photo" ? photoName(now, mime) : "file");
  const size = typeof asset.size === "number" && asset.size >= 0 ? asset.size : null;
  return { uri: asset.uri, type, name, mime, size };
}

/**
 * Keep the files that fit and say what was skipped. Files over the size limit are dropped with a
 * message; once the reply is full the rest are dropped with another.
 */
export function admitFiles(
  files: readonly PickedFile[],
  count: number,
): { kept: PickedFile[]; message: string | null } {
  const full = fullMessage(count);
  if (full) return { kept: [], message: full };
  const kept: PickedFile[] = [];
  let message: string | null = null;
  for (const file of files) {
    const tooBig = sizeMessage(file.name, file.size);
    if (tooBig) {
      message ??= tooBig;
      continue;
    }
    if (kept.length >= roomLeft(count)) {
      message ??= skippedMessage(files.length, kept.length);
      break;
    }
    kept.push(file);
  }
  return { kept, message };
}

/** The reply text as `answers.record` takes it: line breaks become spaces (the backend wants one line), trimmed, capped. */
export function replyText(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, REPLY_MAX);
}

/**
 * Dictation text: what was typed before, then the words heard so far, with one space between.
 * Interim results replace each other, so the caller keeps `before` fixed for the whole utterance.
 */
export function withDictation(before: string, heard: string): string {
  const words = heard.trim();
  if (!words) return before;
  const head = before.replace(/\s+$/, "");
  return head ? `${head} ${words}` : words;
}

/** Send is enabled with some words, a file, or an armed or checked option, and nothing still uploading. */
export function canSend(input: {
  text: string;
  attachments: number;
  hasOption: boolean;
  uploading: boolean;
  failed: boolean;
}): boolean {
  if (input.uploading || input.failed) return false;
  return replyText(input.text) !== "" || input.attachments > 0 || input.hasOption;
}

/** The `storageId` in Convex's upload response, or null when the body is not what it promises. */
export function storageIdFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const id = (body as { storageId?: unknown }).storageId;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Picks from the camera. The photo is full size (Q22). */
export async function takePhoto(): Promise<PickResult> {
  const ImagePicker = await import("expo-image-picker");
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { status: "denied", message: "Allow the camera in Settings to take a photo" };
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
  if (result.canceled) return { status: "cancelled" };
  return {
    status: "ok",
    files: result.assets.map((asset) =>
      pickedFile("photo", { uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType, size: asset.fileSize }),
    ),
  };
}

/** Picks from the photo library, up to `limit` at once. */
export async function choosePhotos(limit: number): Promise<PickResult> {
  const ImagePicker = await import("expo-image-picker");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    allowsMultipleSelection: limit > 1,
    selectionLimit: Math.max(1, limit),
  });
  if (result.canceled) return { status: "cancelled" };
  return {
    status: "ok",
    files: result.assets.map((asset) =>
      pickedFile("photo", { uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType, size: asset.fileSize }),
    ),
  };
}

/** Picks documents of any kind. They are sent as `file`, even when the document is an image. */
export async function chooseFiles(): Promise<PickResult> {
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return { status: "cancelled" };
  return {
    status: "ok",
    files: result.assets.map((asset) =>
      pickedFile("file", { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }),
    ),
  };
}

/** POSTs `body` to a Convex upload URL and resolves with the storage id. Aborts when `signal` does. */
function postToStorage(
  uploadUrl: string,
  body: Blob,
  mime: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
        return;
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // Falls through to the error below.
      }
      const storageId = storageIdFrom(parsed);
      if (storageId) resolve(storageId);
      else reject(new Error("Upload failed. Try again."));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Try again."));
    xhr.onabort = () => reject(new UploadCancelled());
    if (signal) {
      if (signal.aborted) {
        reject(new UploadCancelled());
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

/** Thrown when an upload is cancelled (the person removed it). Not an error to show. */
export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelled";
  }
}

/**
 * Reads the file, checks its real size against the 20 MB limit, asks for an upload URL and uploads,
 * reporting progress from 0 to 1. Resolves with what `answers.record` needs for this file.
 */
export async function uploadAttachment(
  file: PickedFile,
  getUploadUrl: () => Promise<string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadedAttachment> {
  const read = await fetch(file.uri);
  const blob = await read.blob();
  if (signal?.aborted) throw new UploadCancelled();
  const tooBig = sizeMessage(file.name, blob.size);
  if (tooBig) throw new Error(tooBig);
  const uploadUrl = await getUploadUrl();
  if (signal?.aborted) throw new UploadCancelled();
  const storageId = await postToStorage(uploadUrl, blob, file.mime, onProgress, signal);
  onProgress(1);
  return { storageId, type: file.type, name: file.name, mime: file.mime, size: blob.size };
}
