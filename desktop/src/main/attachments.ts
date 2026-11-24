import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Utils } from "electrobun/bun";
import { clientApi, type RecordAnswerArgs } from "@puck/client";
import { AlertValidationError, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, validateAttachments, type AttachmentMeta } from "@puck/shared";
import type { ConvexClient } from "convex/browser";
import type { DesktopAttachment, DesktopRPC } from "../protocol";

type Stored = NonNullable<RecordAnswerArgs["attachments"]>[number];
type PickResult = DesktopRPC["bun"]["requests"]["chooseAttachments"]["response"];
type FileInfo = { dev: number; ino: number; size: number; mtimeMs: number };
type Picked = { id: string; file: string; info: FileInfo; metadata: AttachmentMeta; uploaded?: Stored };

function isSameFile(left: FileInfo, right: FileInfo): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export class ReplyAttachments {
  private readonly byAlert = new Map<string, Map<string, Picked>>();

  retain(questionIds: readonly string[]): void {
    const pending = new Set(questionIds);
    for (const id of this.byAlert.keys()) {
      if (!pending.has(id)) this.byAlert.delete(id);
    }
  }

  private selected(questionId: string, ids: string[]): Picked[] {
    const attachments = this.byAlert.get(questionId);
    if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length) {
      throw new AlertValidationError("Choose up to five distinct files.");
    }
    return ids.map((id) => {
      const item = attachments?.get(id);
      if (!item) throw new AlertValidationError("Please attach the file again.");
      return item;
    });
  }

  async pick(questionId: string, ids: string[], stillPending: () => boolean): Promise<PickResult> {
    try {
      const chosen = this.selected(questionId, ids);
      const paths = await Utils.openFileDialog({ canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: false });
      if (!stillPending()) return { ok: false, error: "This alert is no longer open." };
      // Electrobun 1.18.1 splits the native response on commas. With one selection
      // we can recover a filename containing commas without guessing at file boundaries.
      const path = paths.join(",");
      const files = path && !chosen.some((item) => item.file === path) ? [path] : [];
      if (files.length + chosen.length > MAX_ATTACHMENTS) return { ok: false, error: "Attach up to five files." };
      for (const file of files) {
        const info = await stat(file);
        if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES) {
          return { ok: false, error: "Choose files of 20 MB or less." };
        }
        const mime = Bun.file(file).type.split(";")[0] || "application/octet-stream";
        const [metadata] = validateAttachments([{ type: mime.startsWith("image/") ? "photo" : "file", name: basename(file), mime, size: info.size }]);
        if (metadata) chosen.push({ id: crypto.randomUUID(), file, info, metadata });
      }
      if (!stillPending()) return { ok: false, error: "This alert is no longer open." };
      this.byAlert.set(questionId, new Map(chosen.map((item) => [item.id, item])));
      const attachments: DesktopAttachment[] = chosen.map(({ id, metadata: { name, size } }) => ({ id, name, size }));
      return { ok: true, attachments };
    } catch {
      return { ok: false, error: "Puck couldn’t attach those files." };
    }
  }

  async upload(client: ConvexClient, clientId: string, questionId: string, ids: string[], stillPending: () => boolean): Promise<Stored[]> {
    const selected = this.selected(questionId, ids);
    for (const item of selected) {
      if (!stillPending()) throw new AlertValidationError("This alert is no longer open.");
      if (item.uploaded) continue;
      const file = await open(item.file, "r");
      let bytes;
      try {
        if (!isSameFile(item.info, await file.stat())) throw new AlertValidationError("A file changed. Attach it again.");
        bytes = new Uint8Array(item.info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) throw new AlertValidationError("A file changed. Attach it again.");
          offset += bytesRead;
        }
        if (!isSameFile(item.info, await file.stat())) throw new AlertValidationError("A file changed. Attach it again.");
      } finally {
        await file.close();
      }
      if (!stillPending()) throw new AlertValidationError("This alert is no longer open.");
      const uploadUrl = await client.mutation(clientApi.files.generateUploadUrl, { clientId });
      const response = await fetch(uploadUrl, {
        method: "POST", headers: { "Content-Type": item.metadata.mime }, body: bytes, signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new AlertValidationError("A file couldn’t be uploaded. Try sending again.");
      const { storageId } = await response.json() as { storageId?: Stored["storageId"] };
      if (!storageId) throw new AlertValidationError("A file couldn’t be uploaded. Try sending again.");
      item.uploaded = { storageId, ...item.metadata };
    }
    return selected.flatMap(({ uploaded }) => uploaded ? [uploaded] : []);
  }
}
