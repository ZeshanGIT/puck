// Pure rules for reply attachments, kept out of the Convex functions so they can be tested.

import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type AnswerAttachment,
  type AttachmentMeta,
  type AttachmentType,
} from "@puck/shared";

export { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES };

/** The longest file name the backend stores, extension included. */
export const FILE_NAME_MAX = 120;

const EXTENSION_MAX = 10;
// Control characters, path separators and the characters Windows and shells dislike.
const UNSAFE_NAME_CHARS = /[\u0000-\u001F\u007F\\/:*?"<>|]+/g;

/** The name used when the phone sent none, or one that cleans down to nothing. */
export function fallbackFileName(type: AttachmentType): string {
  return type === "photo" ? "photo.jpg" : "file";
}

/**
 * A file name that is safe to show and to send to a bot: no path parts, control characters or
 * leading dots, whitespace collapsed, at most `FILE_NAME_MAX` characters with the extension kept.
 */
export function cleanFileName(name: string, type: AttachmentType): string {
  const cleaned = name
    .replace(/\s+/g, " ")
    .replace(UNSAFE_NAME_CHARS, "_")
    .trim()
    .replace(/^[.\s_]+/, "")
    .trim();
  if (!cleaned) return fallbackFileName(type);
  if (cleaned.length <= FILE_NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= EXTENSION_MAX + 1 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, FILE_NAME_MAX - extension.length).trimEnd() + extension;
}

/** `ctx.db.system.get("_storage", id)` fields the checks need. */
export interface StoredFile {
  size: number;
  contentType?: string;
}

/**
 * Check one attachment against the file Convex actually holds. The size the phone declared is
 * not trusted: the stored size must be within the limit, and it is what gets recorded.
 * Throws a message fit to show Seshan. Returns the metadata to store.
 */
export function reconcileAttachment(
  declared: AttachmentMeta,
  stored: StoredFile | null,
  index: number,
): AttachmentMeta {
  if (!stored) throw new Error(`attachment ${index + 1} was not uploaded`);
  if (stored.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment ${index + 1} is over the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`);
  }
  return {
    type: declared.type,
    name: cleanFileName(declared.name, declared.type),
    mime: declared.mime,
    size: stored.size,
  };
}

/** Throws when the same stored file is attached twice. */
export function assertDistinctStorageIds(storageIds: readonly string[]): void {
  if (new Set(storageIds).size !== storageIds.length) throw new Error("the same file is attached twice");
}

/** One webhook attachment: the stored metadata plus a freshly generated storage URL. */
export function payloadAttachment(
  stored: { type: AttachmentType; name: string; mime: string; size: number },
  url: string,
): AnswerAttachment {
  return { type: stored.type, name: stored.name, mime: stored.mime, size: stored.size, url };
}
