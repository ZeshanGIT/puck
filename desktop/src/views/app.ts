import { Electroview } from "electrobun/view";
import type { DesktopAlert, DesktopResult, DesktopRPC, DesktopState } from "../protocol";
import { alertTime, avatar, brand, button, colourFor, darkMode, element, empty, notice } from "./elements";
import { newDraft, replyEditor, type Draft } from "./reply";

type View = "card" | "inbox";

const CONNECTION_LABEL = { connecting: "Connecting", online: "Connected", offline: "Offline" } as const;
const WORKING_LABEL = {
  answer: "Sending reply…",
  snooze: "Snoozing…",
  other: "Working…",
} as const;

export function mount(view: View) {
  const root = document.getElementById("app")!;
  const announcement = document.getElementById("announcement")!;
  let state: DesktopState = {
    session: { status: "loading" }, alerts: [], cardId: null, connection: "connecting",
  };
  let selectedId: string | null = null;
  let preferredId: string | null = null;
  let operation: keyof typeof WORKING_LABEL | null = null;
  let feedback: { text: string; error?: boolean; id?: string } | null = null;
  let snapshotSequence = 0;
  let operationFocus: string | null = null;
  const drafts = new Map<string, Draft>();
  const completed = new Set<string>();

  function applyState(next: DesktopState) {
    ++snapshotSequence;
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    const oldSession = state.session;
    if (next.session.status === "ready" &&
      (oldSession.status !== "ready" || oldSession.account !== next.session.account)) {
      drafts.clear();
      completed.clear();
      feedback = null;
    }
    if (next.session.status === "ready" && next.connection === "online") {
      const pending = new Set(next.alerts.map(alert => alert.questionId));
      for (const id of completed) if (!pending.has(id)) completed.delete(id);
      for (const id of drafts.keys()) if (!pending.has(id)) drafts.delete(id);
    }
    state = next;
    render();
  }

  const rpc = Electroview.defineRPC<DesktopRPC>({
    maxRequestTime: 180_000,
    handlers: {
      messages: {
        stateChanged: applyState,
        selectAlert: ({ questionId }) => {
          if (view !== "inbox") return;
          preferredId = questionId;
          render("detail-heading");
        },
      },
    },
  });
  new Electroview({ rpc });

  async function refresh() {
    const sequence = snapshotSequence;
    const next = await rpc.request.getState();
    if (sequence === snapshotSequence) applyState(next);
  }

  function speak(message: string) {
    announcement.textContent = message;
  }

  async function act(
    task: () => Promise<DesktopResult>,
    kind: keyof typeof WORKING_LABEL = "other",
    context?: { id: string; success?: string },
  ) {
    if (operation) return;
    operation = kind;
    operationFocus = document.activeElement?.id || null;
    feedback = null;
    speak(WORKING_LABEL[kind]);
    render();
    try {
      const result = await task();
      if (!result.ok) {
        feedback = { text: result.error, error: true, id: context?.id };
      } else if (context?.success) {
        feedback = { text: context.success };
        if (state.alerts.some(alert => alert.questionId === context.id)) completed.add(context.id);
        drafts.delete(context.id);
      }
      if (feedback) speak(feedback.text);
    } catch {
      feedback = { text: "Puck could not complete that action. Try again.", error: true, id: context?.id };
      speak(feedback.text);
    } finally {
      operation = null;
      const focus = feedback?.error ? operationFocus ?? undefined
        : context?.success ? "detail-heading" : undefined;
      operationFocus = null;
      render(focus);
    }
  }

  function connection() {
    const node = element("span", `connection ${state.connection}`, CONNECTION_LABEL[state.connection]);
    node.title = state.error ?? CONNECTION_LABEL[state.connection];
    return node;
  }

  function feedbackFor(id?: string) {
    if (feedback && (!feedback.id || feedback.id === id)) return notice(feedback.text, feedback.error);
    if (operation) return notice(WORKING_LABEL[operation]);
    return null;
  }

  function signInView() {
    switch (state.session.status) {
      case "loading":
        if (state.error) {
          return empty("Puck could not start", state.error, button("Try again", () => void start(), "primary"));
        }
        return empty("Starting Puck", "Connecting to the desktop app…");
      case "signing-in":
        return empty("Signing in", "Finish signing in in your browser, then return to Puck.");
      case "signed-out": {
        const signIn = button(
          view === "card" ? "Open inbox to sign in" : "Continue with Google",
          () => void act(() => view === "card" ? rpc.request.openInbox({}) : rpc.request.signIn()),
          "primary",
        );
        signIn.id = "sign-in";
        signIn.disabled = operation !== null;
        return empty(
          "Sign in to Puck",
          feedback?.text ?? state.session.error ?? "Use your Puck account to receive and answer your bots’ alerts on this Mac.",
          signIn,
        );
      }
      case "ready":
        return empty("All quiet", "Nothing is waiting for your response.");
    }
  }

  function reply(alert: DesktopAlert) {
    const id = alert.questionId;
    const draft = drafts.get(id) ?? newDraft();
    drafts.set(id, draft);
    const expired = alert.expiresAt !== undefined && alert.expiresAt <= Date.now();
    const blocked = expired ? "This alert has expired."
      : state.connection === "online" ? null
      : state.connection === "offline" ? "Replies and snoozing resume when Puck reconnects."
      : "Connecting to Puck…";
    const editor = replyEditor(alert, draft, {
      answer: params => void act(() => rpc.request.answer(params), "answer", { id, success: "Reply saved." }),
      snooze: minutes => void act(
        () => rpc.request.snooze({ questionId: id, minutes }), "snooze", { id, success: "Alert snoozed." },
      ),
      openLink: () => void act(() => rpc.request.openLink({ questionId: id }), "other", { id }),
      refresh: render,
    }, blocked, operation !== null);
    const heading = editor.querySelector("h1")!;
    heading.id = "detail-heading";
    heading.tabIndex = -1;
    const status = feedbackFor(id);
    if (status) editor.prepend(status);
    return editor;
  }

  function inbox(alerts: DesktopAlert[]) {
    if (state.session.status !== "ready") {
      return element("main", "sign-in",
        element("header", "toolbar row spread", brand(), connection()), signInView());
    }
    const signOut = button("Sign out", () => void act(() => rpc.request.signOut()), "quiet");
    signOut.id = "sign-out";
    signOut.disabled = operation !== null;
    const account = element("span", "account", state.session.account);
    account.title = state.session.account;
    const toolbar = element("header", "toolbar row spread",
      brand(), element("div", "toolbar-actions row", connection(), account, signOut));
    const list = element("ul", "alert-list");
    const requested = alerts.find(alert => alert.questionId === preferredId);
    if (requested) {
      selectedId = requested.questionId;
      preferredId = null;
    }
    const selected = alerts.find(alert => alert.questionId === selectedId) ?? alerts[0];
    selectedId = selected?.questionId ?? null;
    for (const [index, alert] of alerts.entries()) {
      const row = element("button", "alert-row row",
        avatar(colourFor(alert.botColour), alert.botShape ?? "round", 32),
        element("div", "grow",
          element("div", "alert-meta row spread",
            element("span", "sender", alert.botName),
            alert.priority === "urgent" ? element("span", "badge urgent", "Urgent") : alertTime(alert.createdAt),
          ),
          element("div", "alert-title", alert.question),
        ),
      );
      row.type = "button";
      row.id = `alert-row-${alert.questionId}`;
      row.setAttribute("aria-current", String(alert === selected));
      row.onclick = () => {
        preferredId = null;
        selectedId = alert.questionId;
        feedback = null;
        render("detail-heading");
      };
      row.onkeydown = event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? alerts.length - 1
          : Math.min(alerts.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
        document.getElementById(`alert-row-${alerts[next]?.questionId}`)?.focus();
      };
      list.append(element("li", "", row));
    }
    const heading = element("h1", "", "Inbox");
    heading.id = "inbox-heading";
    heading.tabIndex = -1;
    const sidebar = element("nav", "inbox-list",
      element("div", "list-heading row spread", heading, element("span", "count", String(alerts.length))), list);
    sidebar.setAttribute("aria-label", "Waiting alerts");
    const detail = element("main", "detail-pane");
    if (selected) {
      detail.append(element("div", "detail-inner", reply(selected)));
    } else {
      const status = feedbackFor();
      const title = state.connection === "online" ? "All quiet" : CONNECTION_LABEL[state.connection];
      const description = status?.textContent ?? (state.connection === "online"
        ? "Nothing is waiting for your response."
        : state.error ?? "Waiting for a connection to your inbox.");
      detail.append(empty(title, description));
    }
    return element("div", "inbox-shell", toolbar, sidebar, detail);
  }

  function dismiss() {
    const id = state.cardId;
    if (id) void act(() => rpc.request.dismissCard({ questionId: id }), "other", { id });
  }

  function card(alerts: DesktopAlert[]) {
    const alert = alerts.find(item => item.questionId === state.cardId);
    const open = button("Open inbox", () => void act(
      () => rpc.request.openInbox(alert ? { questionId: alert.questionId } : {}),
    ), "quiet");
    open.id = "open-inbox";
    open.disabled = operation !== null;
    const close = button("×", dismiss, "quiet icon-btn");
    close.id = "close-card";
    close.setAttribute("aria-label", "Dismiss card");
    close.title = "Dismiss card (Escape)";
    close.disabled = !state.cardId || operation !== null;
    const toolbar = element("header", "card-toolbar row spread",
      brand(), element("div", "row", open, close));
    const content = state.session.status !== "ready" ? signInView()
      : alert ? reply(alert)
      : empty("No alert to reply to", feedback?.text ?? "This alert is no longer waiting.");
    return element("div", `card-shell${alert?.priority === "urgent" ? " is-urgent" : ""}`,
      toolbar, element("main", "card-scroll", content));
  }

  function render(focus?: string) {
    const active = document.activeElement;
    const oldFocus = active?.id || (active?.closest(".more") ? "alert-details-summary" : "");
    const selection = active instanceof HTMLInputElement && active.type === "text"
      ? [active.selectionStart, active.selectionEnd] as const : null;
    const paneSelector = view === "inbox" ? ".detail-pane" : ".card-scroll";
    const previousId = view === "inbox" ? selectedId : root.dataset.cardId;
    const detailScroll = root.querySelector(paneSelector)?.scrollTop ?? 0;
    const listScroll = root.querySelector(".alert-list")?.scrollTop ?? 0;
    const alerts = state.session.status === "ready"
      ? state.alerts.filter(alert => !completed.has(alert.questionId)).sort((a, b) =>
        Number(b.priority === "urgent") - Number(a.priority === "urgent") || b.createdAt - a.createdAt)
      : [];
    if (view === "card") root.dataset.cardId = state.cardId ?? "";
    root.replaceChildren(view === "inbox" ? inbox(alerts) : card(alerts));
    if (previousId === (view === "inbox" ? selectedId : root.dataset.cardId)) {
      root.querySelector(paneSelector)?.scrollTo(0, detailScroll);
    }
    root.querySelector(".alert-list")?.scrollTo(0, listScroll);
    const next = document.getElementById(focus ?? oldFocus);
    if (next) {
      next.focus({ preventScroll: focus === undefined });
      if (selection && next instanceof HTMLInputElement && next.type === "text") {
        next.setSelectionRange(...selection);
      }
    } else if (view === "inbox" && (oldFocus || focus === "detail-heading")) {
      const fallback = selectedId ? `alert-row-${selectedId}` : "inbox-heading";
      (document.getElementById(fallback) ?? document.getElementById("sign-in"))?.focus();
    }
  }

  async function start() {
    render();
    try {
      await refresh();
    } catch {
      if (state.session.status !== "loading") return;
      applyState({ ...state, error: "The desktop bridge did not respond." });
    }
  }

  darkMode.addEventListener("change", () => render());
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || operation) return;
    const cancel = document.getElementById("cancel-confirmation");
    if (cancel) {
      event.preventDefault();
      cancel.click();
    } else if (view === "card" && state.cardId) {
      event.preventDefault();
      dismiss();
    }
  });
  void start();
}
