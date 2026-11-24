import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, Screen, Utils } from "electrobun/bun";
import { clientApi } from "@puck/client";
import { AlertValidationError, validateAnswer } from "@puck/shared";
import { floatingCard } from "../floatingCardMachine";
import type { DesktopAlert, DesktopResult, DesktopRPC, DesktopState } from "../protocol";
import { keychain, signInWithBrowser } from "./auth";
import { DesktopInbox } from "./inbox";
import type { DesktopAccount } from "./keychain";

const ok = { ok: true } as const;
const failure = (error: string): DesktopResult => ({ ok: false, error });
const cardSize = { width: 384, height: 440 };
type ViewName = "inbox" | "card";

let state: DesktopState = { session: { status: "loading" }, alerts: [], cardId: null, connection: "connecting" };
let inbox: DesktopInbox | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let inboxFocused = false;
let selection: string | undefined;
let cardState = floatingCard.initial;
const views: Partial<Record<ViewName, ReturnType<typeof createView>>> = {};

function publish(next: DesktopState): void {
  const cardChanged = next.cardId !== state.cardId;
  state = next;
  if (cardChanged && !state.cardId) views.card?.window.hide();
  for (const view of Object.values(views)) {
    if (view.ready) view.rpc.send.stateChanged(state);
  }
  if (cardChanged && state.cardId) {
    const card = views.card ??= createView("card");
    if (card.ready) showCard(card.window);
  }
}

function showCard(window: BrowserWindow): void {
  const cursor = Screen.getCursorScreenPoint();
  const display = Screen.getAllDisplays().find(({ bounds }) =>
    cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
  ) ?? Screen.getPrimaryDisplay();

  const { x, y, width, height } = display.workArea;
  if (width > 0 && height > 0) {
    const margin = 16;
    const w = Math.min(cardSize.width, Math.max(1, width - 2 * margin));
    const h = Math.min(cardSize.height, Math.max(1, height - 2 * margin));
    window.setFrame(x + width - w - margin, y + height - h - margin, w, h);
  }
  window.showInactive();
}

function dismissCard(questionId: string): DesktopResult {
  cardState = floatingCard.transition(cardState, { type: "dismiss", questionId });
  publish({ ...state, cardId: cardState.queue[0] ?? null });
  return ok;
}

function hideCards(): void {
  cardState = floatingCard.transition(cardState, { type: "hide" });
  if (state.cardId) publish({ ...state, cardId: null });
}

function createView(name: ViewName) {
  const isCard = name === "card";
  const rpc = BrowserView.defineRPC<DesktopRPC>({
    handlers: {
      requests: {
        getState: () => {
          view.ready = true;
          if (isCard && state.cardId) showCard(view.window);
          if (!isCard) setTimeout(sendSelection, 0);
          return state;
        },
        signIn: () => isCard ? failure("Open the inbox to sign in.") : signIn(),
        signOut: () => isCard ? failure("Open the inbox to sign out.") : signOut(),
        answer: ({ questionId, optionIds, customReply, confirmDestructive }) =>
          performAction(name, questionId, async (client, clientId, alert) => {
            if (!confirmDestructive && (alert.requiresUnlock || alert.options.some((option) => optionIds.includes(option.id) && option.tone === "destructive"))) {
              return failure("Confirm this reply before sending.");
            }
            const answer = validateAnswer({ selectionMode: alert.selectionMode, options: alert.options, optionIds, customReply });
            await client.mutation(clientApi.answers.record, {
              questionId, clientId, optionIds: answer.answers.map(({ id }) => id),
              ...(answer.customReply !== null ? { customReply: answer.customReply } : {}),
            });
            return ok;
          }),
        snooze: ({ questionId, minutes }) => performAction(name, questionId, async (client, clientId) => {
          if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) return failure("Choose a valid snooze duration.");
          await client.mutation(clientApi.answers.snooze, { questionId, clientId, until: Date.now() + minutes * 60_000 });
          return ok;
        }),
        openLink: ({ questionId }) => openLink(questionId),
        dismissCard: ({ questionId }) => dismissCard(questionId),
        openInbox: ({ questionId }) => {
          openInbox(typeof questionId === "string" ? findAlert(questionId)?.questionId : undefined);
          return ok;
        },
      },
    },
  });
  const url = `views://${name}/index.html`;
  const window = new BrowserWindow({
    title: isCard ? "Puck Reply" : "Puck",
    url,
    navigationRules: JSON.stringify([url]),
    rpc,
    renderer: "native",
    hidden: true,
    activate: false,
    frame: isCard ? { x: 0, y: 0, ...cardSize } : { x: 120, y: 90, width: 980, height: 700 },
    ...(isCard ? { titleBarStyle: "hidden", styleMask: { Resizable: false } } : {}),
  });
  const view = { window, rpc, ready: false };

  if (isCard) {
    window.setAlwaysOnTop(true);
    window.setVisibleOnAllWorkspaces(true);
  } else {
    window.on("focus", () => {
      inboxFocused = true;
      hideCards();
    });
    window.on("blur", () => { inboxFocused = false; });
  }
  window.on("close", () => {
    delete views[name];
    if (isCard && state.cardId) dismissCard(state.cardId);
    if (!isCard) inboxFocused = false;
  });
  return view;
}

function sendSelection(): void {
  const view = views.inbox;
  if (!view?.ready || !selection) return;
  const questionId = selection;
  selection = undefined;
  if (findAlert(questionId)) view.rpc.send.selectAlert({ questionId });
}

function openInbox(questionId?: string): void {
  selection = questionId;
  hideCards();
  const view = views.inbox ??= createView("inbox");
  if (view.window.isMinimized()) view.window.unminimize();
  view.window.show();
  sendSelection();
}

function findAlert(questionId: string): DesktopAlert | undefined {
  return state.alerts.find((alert) => alert.questionId === questionId &&
    (alert.expiresAt === undefined || alert.expiresAt > Date.now()));
}

function openLink(questionId: string): DesktopResult {
  const raw = findAlert(questionId)?.link?.url;
  if (raw) {
    try {
      const url = new URL(raw);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && Utils.openExternal(url.href)) {
        return ok;
      }
    } catch {
      // Malformed or unsupported links never reach the system browser.
    }
  }
  return failure("This alert link could not be opened.");
}

async function performAction(
  source: ViewName,
  questionId: string,
  action: (client: DesktopInbox["client"], clientId: string, alert: DesktopAlert) => Promise<DesktopResult>,
): Promise<DesktopResult> {
  const clientId = inbox?.account.clientId;
  if (!inbox || !clientId || state.connection !== "online") return failure("The Puck inbox is offline. Try again when it reconnects.");
  const alert = findAlert(questionId);
  if (!alert || (source === "card" && state.cardId !== questionId)) return failure("This alert is no longer pending.");
  try {
    return await action(inbox.client, clientId, alert);
  } catch (error) {
    if (error instanceof AlertValidationError) return failure(error.message);
    return failure("Puck could not update this alert. It may have changed on another device.");
  }
}

function applyAlerts(alerts: DesktopAlert[], mayNotify: boolean): void {
  clearTimeout(expiryTimer);
  const now = Date.now();
  const current = alerts.filter((alert) => alert.expiresAt === undefined || alert.expiresAt > now);
  const eligible = mayNotify && !inboxFocused
    ? current.filter((alert) => (alert.botMutedUntil ?? 0) <= now)
      .sort((a, b) => Number(b.priority === "urgent") - Number(a.priority === "urgent"))
      .map((alert) => alert.questionId)
    : [];
  cardState = floatingCard.transition(cardState, {
    type: "snapshot",
    pending: current.map((alert) => alert.questionId),
    eligible,
  });

  const nextExpiry = Math.min(...current.map((alert) => alert.expiresAt ?? Infinity));
  if (Number.isFinite(nextExpiry)) {
    expiryTimer = setTimeout(() => applyAlerts(current, false), Math.min(nextExpiry - now, 2_147_483_647));
  }
  publish({ ...state, alerts: current, cardId: cardState.queue[0] ?? null });
}

function connect(account: DesktopAccount): void {
  inbox = new DesktopInbox(account, {
    alerts: applyAlerts,
    connection: (connection, error) => {
      if (connection !== state.connection || error !== state.error) {
        if (connection !== "online") hideCards();
        publish({ ...state, connection, error });
      }
    },
    expired: () => {
      try {
        keychain.clear();
      } catch {
        disconnect("Your session expired. Puck could not clear it from Keychain.");
        return;
      }
      disconnect("Your session expired. Sign in again.");
    },
  });
  publish({ session: { status: "ready", account: account.email }, alerts: [], cardId: null, connection: "connecting" });
  inbox.start();
}

function disconnect(error?: string): void {
  inbox?.close();
  inbox = undefined;
  clearTimeout(expiryTimer);
  cardState = floatingCard.transition(cardState, { type: "reset" });
  publish({ session: { status: "signed-out", error }, alerts: [], cardId: null, connection: "connecting" });
}

function signIn(): DesktopResult {
  if (state.session.status !== "signed-out") return failure("Puck is already signing in or connected.");
  publish({ ...state, session: { status: "signing-in" } });
  void signInWithBrowser().then((account) => {
    keychain.write(account);
    connect(account);
  }).catch(() => disconnect("Google sign-in could not finish. Try again."));
  return ok;
}

function signOut(): DesktopResult {
  if (!inbox) return failure("Puck is not signed in.");
  try {
    keychain.clear();
  } catch {
    return failure("Puck could not clear sign-in from Keychain.");
  }
  const signedOut = inbox;
  disconnect();
  void signedOut.endSession().catch(() => {});
  return ok;
}

ApplicationMenu.setApplicationMenu([
  { label: "Puck", submenu: [{ role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { role: "quit" }] },
  { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  { label: "Window", submenu: [{ label: "Open Inbox", action: "open-inbox" }, { role: "minimize" }, { role: "close" }] },
]);
Electrobun.events.on("application-menu-clicked", (event) => {
  if ((event.data as { action?: string }).action === "open-inbox") openInbox();
});
Electrobun.events.on("reopen", () => openInbox());
Electrobun.events.on("before-quit", () => {
  clearTimeout(expiryTimer);
  inbox?.close();
});

openInbox();
try {
  const account = keychain.read();
  if (account) connect(account);
  else disconnect();
} catch {
  disconnect("Puck could not read sign-in from Keychain.");
}
