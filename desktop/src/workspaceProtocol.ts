import type { clientApi, AlertDetail, BotCatalogItem, ClientCatalogItem } from "@puck/client";
import type { FunctionReturnType } from "convex/server";
import type { BotColour, BotShape } from "@puck/shared";

export type WorkspacePage = "home" | "bots" | "archive" | "settings";
export type { ThemePreference } from "@puck/appearance";
export type LiveTask = FunctionReturnType<typeof clientApi.live.forUser>[number];
export type ArchivedTask = FunctionReturnType<typeof clientApi.live.archive>[number];
export type WaitingAlert = FunctionReturnType<typeof clientApi.alerts.waiting>[number];
export type HistoryItem = FunctionReturnType<typeof clientApi.alerts.history>["page"][number];
export type PairingRequest = FunctionReturnType<typeof clientApi.bots.pairingRequests>[number];

export interface WorkspaceState {
  bots?: BotCatalogItem[];
  pairing?: PairingRequest[];
  clients?: ClientCatalogItem[];
  waiting?: WaitingAlert[];
  live?: LiveTask[];
  archivedTasks?: ArchivedTask[];
  history?: { items: HistoryItem[]; hasMore: boolean };
  detail?: { questionId: string; alert: AlertDetail | null };
  clientId?: string;
  errors: Partial<Record<"bots" | "pairing" | "clients" | "waiting" | "live" | "archivedTasks" | "history" | "detail", string>>;
}

export type WorkspaceCommand =
  | { type: "loadHistory" }
  | { type: "loadDetail"; questionId: string }
  | { type: "wake" }
  | { type: "openTaskLink"; activityId: string }
  | { type: "openDetailLink"; questionId: string }
  | { type: "retryDelivery"; answerId: string }
  | { type: "pair"; pairingCode: string }
  | { type: "rejectPairing"; botId: string }
  | { type: "updateBot"; botId: string; colour?: BotColour; shape?: BotShape; mutedUntil?: number | null }
  | { type: "removeBot"; botId: string }
  | { type: "renameClient"; clientId: string; name: string }
  | { type: "removeClient"; clientId: string }
  | { type: "sendTest" };
