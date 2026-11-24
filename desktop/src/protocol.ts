import type { AlertExtras, AlertOption, BotColour, BotShape, Presentation, Priority, SelectionMode } from "@puck/shared";

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
  cardId: string | null;
  connection: "connecting" | "online" | "offline";
  error?: string;
}

export type DesktopResult = { ok: true } | { ok: false; error: string };

export type DesktopRPC = {
  bun: {
    requests: {
      getState: { params: undefined; response: DesktopState };
      signIn: { params: undefined; response: DesktopResult };
      signOut: { params: undefined; response: DesktopResult };
      answer: {
        params: { questionId: string; optionIds: string[]; customReply?: string; confirmDestructive?: boolean };
        response: DesktopResult;
      };
      snooze: { params: { questionId: string; minutes: number }; response: DesktopResult };
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
