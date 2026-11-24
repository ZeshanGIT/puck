import { openReceipt } from "./activity";
import { Electroview } from "electrobun/view";
import type { DesktopAlert, DesktopResult, DesktopRPC, DesktopState } from "../protocol";
import type { WorkspacePage } from "../workspaceProtocol";
import { applyTheme, brand, button, darkMode, element, empty, notice } from "./elements";
import { newDraft, replyEditor, type Draft } from "./reply";
import { renderWorkspace, workspaceNavigation } from "./workspace";
import type { WorkspaceActions } from "./workspaceActions";

type View = "card" | "inbox";

const CONNECTION_LABEL = { connecting: "Connecting", online: "Connected", offline: "Offline" } as const;
const WORKING_LABEL = {
  answer: "Sending reply…",
  snooze: "Snoozing…",
  attachments: "Choosing attachments…",
  other: "Working…",
} as const;

export function mount(view: View) {
  const root = document.getElementById("app")!;
  const announcement = document.getElementById("announcement")!;
  let state: DesktopState = {
    session: { status: "loading" }, alerts: [], cardId: null, connection: "connecting",
  };
  let page: WorkspacePage = "home";
  let selectedId: string | null = null;
  let preferredId: string | null = null;
  let operation: keyof typeof WORKING_LABEL | null = null;
  let feedback: { text: string; error?: boolean; id?: string; receiptId?: string } | null = null;
  let snapshotSequence = 0;
  let operationFocus: string | null = null;
  const drafts = new Map<string, Draft>();
  const completed = new Set<string>();

  function applyState(next: DesktopState) {
    ++snapshotSequence;
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    const oldSession = state.session;
    const oldAccount = oldSession.status === "ready" ? oldSession.account : null;
    const nextAccount = next.session.status === "ready" ? next.session.account : null;
    if (oldAccount !== nextAccount) {
      if (oldAccount !== null) {
        selectedId = null;
        preferredId = null;
        page = "home";
      }
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
          if (view === "inbox") openAlert(questionId);
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
        feedback = { text: context.success, receiptId: kind === "answer" ? context.id : undefined };
        if (state.alerts.some(alert => alert.questionId === context.id)) completed.add(context.id);
        drafts.delete(context.id);
      }
      if (feedback) speak(feedback.text);
    } catch {
      feedback = { text: "Puck could not complete that action. Try again.", error: true, id: context?.id };
      speak(feedback.text);
    } finally {
      operation = null;
      const focus = feedback?.error || kind === "attachments" ? operationFocus ?? undefined
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
    if (feedback && (!feedback.id || feedback.id === id)) {
      const message = notice(feedback.text, feedback.error);
      const receiptId = feedback.receiptId;
      if (view === "inbox" && receiptId) {
        const receipt = button("View receipt", () => {
          navigate("archive");
          openReceipt(state, receiptId, workspaceActions);
        });
        receipt.id = "view-receipt";
        return element("div", "row wrap", message, receipt);
      }
      return message;
    }
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
      chooseAttachments: selectedIds => void act(async () => {
        const result = await rpc.request.chooseAttachments({ questionId: id, selectedIds });
        if (result.ok) draft.attachments = result.attachments;
        return result;
      }, "attachments", { id }),
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

  function navigate(next: WorkspacePage) {
    if (next === "home") {
      selectedId = null;
      preferredId = null;
    }
    page = next;
    render(`nav-${page}`);
  }

  function openAlert(questionId: string) {
    page = "home";
    preferredId = questionId;
    selectedId = null;
    feedback = null;
    render("detail-heading");
  }

  async function workspaceRequest(task: () => Promise<DesktopResult>): Promise<DesktopResult> {
    try {
      return await task();
    } catch {
      return { ok: false, error: "Puck could not complete that action. Try again." };
    }
  }

  const workspaceActions: WorkspaceActions = {
    command: command => workspaceRequest(() => rpc.request.workspaceCommand(command)),
    setThemePreference: preference => workspaceRequest(() => rpc.request.setThemePreference({ preference })),
    signOut: () => workspaceRequest(() => rpc.request.signOut()),
    navigate,
    openAlert,
    refresh: () => render(),
  };

  function inbox(alerts: DesktopAlert[]) {
    if (state.session.status !== "ready") {
      return element("main", "sign-in",
        element("header", "toolbar row spread", brand(), connection()), signInView());
    }
    const requested = alerts.find(alert => alert.questionId === preferredId);
    if (requested) {
      selectedId = requested.questionId;
      preferredId = null;
    }
    const selected = page === "home" ? alerts.find(alert => alert.questionId === selectedId) : undefined;
    if (page === "home") selectedId = selected?.questionId ?? null;

    const navigation = element("aside", "workspace-sidebar",
      element("header", "sidebar-brand", brand()),
      workspaceNavigation(page, navigate), connection());
    const visibleState = { ...state, alerts };
    if (state.workspace?.waiting && completed.size) {
      visibleState.workspace = {
        ...state.workspace, waiting: state.workspace.waiting.filter(alert => !completed.has(alert.questionId)),
      };
    }
    const content = renderWorkspace(page, visibleState, workspaceActions);
    if (page === "home" && selected) {
      content.querySelector(`#activity-row-${CSS.escape(selected.questionId)}`)?.setAttribute("aria-current", "true");
    }
    const feedbackNode = page === "home" && !selected ? feedbackFor() : null;
    const pageScroll = element("div", "workspace-page", content);
    if (feedbackNode) pageScroll.prepend(feedbackNode);
    const main = element("main", "workspace-main", pageScroll);
    if (page === "home" && selected) {
      main.classList.add("with-reply");
      const back = button("Back to Home", () => navigate("home"), "quiet");
      back.id = "close-detail";
      const detail = element("section", "detail-pane",
        element("div", "detail-inner", back, reply(selected)));
      detail.setAttribute("aria-labelledby", "detail-heading");
      main.append(detail);
    }
    return element("div", "inbox-shell", navigation, main);
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
    applyTheme(state.themePreference);
    const active = document.activeElement;
    const oldFocus = active?.id || (active?.closest(".more") ? "alert-details-summary" : "");
    const selection = active instanceof HTMLInputElement && active.type === "text"
      ? [active.selectionStart, active.selectionEnd] as const : null;
    const paneSelector = view === "inbox" ? ".detail-pane" : ".card-scroll";
    const previousId = root.dataset.detailId;
    const detailScroll = root.querySelector(paneSelector)?.scrollTop ?? 0;
    const previousPage = root.dataset.page;
    const pageScroll = root.querySelector(".workspace-page")?.scrollTop ?? 0;
    const alerts = state.session.status === "ready"
      ? state.alerts.filter(alert => !completed.has(alert.questionId)).sort((a, b) =>
        Number(b.priority === "urgent") - Number(a.priority === "urgent") || b.createdAt - a.createdAt)
      : [];
    root.replaceChildren(view === "inbox" ? inbox(alerts) : card(alerts));
    const detailId = view === "card" ? state.cardId : page === "home" ? selectedId : null;
    root.dataset.detailId = detailId ?? "";
    if (previousId === root.dataset.detailId) {
      root.querySelector(paneSelector)?.scrollTo(0, detailScroll);
    }
    if (previousPage === page) root.querySelector(".workspace-page")?.scrollTo(0, pageScroll);
    root.dataset.page = page;
    const detailArrived = previousId !== root.dataset.detailId && Boolean(root.dataset.detailId);
    const focusId = focus ?? (view === "inbox" && detailArrived ? "detail-heading" : oldFocus);
    const next = document.getElementById(focusId);
    if (next) {
      next.focus({ preventScroll: focus === undefined });
      if (selection && next instanceof HTMLInputElement && next.type === "text") {
        next.setSelectionRange(...selection);
      }
    } else if (view === "inbox" && (oldFocus || focus === "detail-heading")) {
      (document.getElementById(`nav-${page}`) ?? document.getElementById("sign-in"))?.focus();
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
    } else if (view === "inbox" && page === "home" && selectedId) {
      event.preventDefault();
      navigate("home");
    } else if (view === "card" && state.cardId) {
      event.preventDefault();
      dismiss();
    }
  });
  void start();
}
