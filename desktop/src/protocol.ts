import type { AlertExtras, AlertOption, BotColour, BotShape, Presentation, Priority, SelectionMode } from "@puck/shared";

import type { ThemePreference, WorkspaceCommand, WorkspaceState } from "./workspaceProtocol";

export interface DesktopAlert extends AlertExtras {
  questionId: string;
  question: string;
  botId: string;
  botName: string;
  botColour?: BotColour;
  botShape?: BotShape;
  botMutedUntil?: number;
  priority: Priority;
  selectionMode: SelectionMode;
  presentation: Presentation;
  options: AlertOption[];
  createdAt: number;
}

export type DesktopSession =
  | { status: "loading" }
  | { status: "signed-out"; error?: string }
  | { status: "signing-in" }
  | { status: "ready"; account: string };

export interface DesktopState {
  session: DesktopSession;
  alerts: DesktopAlert[];
  workspace?: WorkspaceState;
  themePreference?: ThemePreference;
  cardId: string | null;
  connection: "connecting" | "online" | "offline";
  error?: string;
}

export interface DesktopAttachment {
  id: string;
  name: string;
  size: number;
}

export type DesktopResult = { ok: true } | { ok: false; error: string };

export type DesktopRPC = {
  bun: {
    requests: {
      getState: { params: undefined; response: DesktopState };
      workspaceCommand: { params: WorkspaceCommand; response: DesktopResult };
      setThemePreference: { params: { preference: ThemePreference }; response: DesktopResult };
      signIn: { params: undefined; response: DesktopResult };
      signOut: { params: undefined; response: DesktopResult };
      chooseAttachments: {
        params: { questionId: string; selectedIds: string[] };
        response: { ok: true; attachments: DesktopAttachment[] } | { ok: false; error: string };
      };
      answer: {
        params: { questionId: string; optionIds: string[]; customReply?: string; confirmDestructive?: boolean; attachmentIds?: string[] };
        response: DesktopResult;
      };
      snooze: { params: { questionId: string; minutes: number | null }; response: DesktopResult };
      dismissCard: { params: { questionId: string }; response: DesktopResult };
      openInbox: { params: { questionId?: string }; response: DesktopResult };
      openLink: { params: { questionId: string }; response: DesktopResult };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {
      stateChanged: DesktopState;
      selectAlert: { questionId: string };
    };
  };
};
