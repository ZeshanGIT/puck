import { receiptLine, type AlertDetail } from "@puck/client";
import type { DesktopState } from "../protocol";
import type { ArchivedTask, HistoryItem, LiveTask, WorkspaceCommand } from "../workspaceProtocol";
import { alertTime, avatar, botAppearance, button, element, empty, notice, setBotTheme } from "./elements";
import type { WorkspaceActions } from "./workspaceActions";

const FILTERS = {
  all: "All activity",
  alerts: "Alerts",
  tasks: "Tasks",
  failed: "Failed deliveries",
} as const;
type Filter = keyof typeof FILTERS;
type Selection = { kind: "alert" | "task"; id: string };
type Page = "home" | "archive";

interface ViewModel {
  archive?: Selection;
  home?: Selection;
  filter: Filter;
  expandedDetails: Set<string>;
  operations: Map<string, { error?: string }>;
}

function newViewModel(): ViewModel {
  return { filter: "all", expandedDetails: new Set(), operations: new Map() };
}

let model = newViewModel();
let account: string | undefined;

function viewModel(state: DesktopState) {
  const current = state.session.status === "ready" ? state.session.account : undefined;
  if (account !== current) {
    account = current;
    model = newViewModel();
  }
  return model;
}

function root() {
  return element("section", "activity-view stack");
}

function heading(title: string) {
  const node = element("h1", "", title);
  node.id = "activity-heading";
  node.tabIndex = -1;
  return node;
}

function section(title: string, ...children: Node[]) {
  return element("section", "activity-section stack", element("h2", "kicker", title), ...children);
}

function showSelection(view: ViewModel, page: Page, selection: Selection | undefined, actions: WorkspaceActions) {
  view[page] = selection;
  actions.refresh();
  document.getElementById("activity-heading")?.focus();
}

function openDetail(view: ViewModel, page: Page, questionId: string, actions: WorkspaceActions) {
  view[page] = { kind: "alert", id: questionId };
  delete view[page === "home" ? "archive" : "home"];
  void run(view, `detail-${questionId}`, { type: "loadDetail", questionId }, actions);
  document.getElementById("activity-heading")?.focus();
}

async function run(view: ViewModel, key: string, command: WorkspaceCommand, actions: WorkspaceActions) {
  const previous = view.operations.get(key);
  if (previous && previous.error === undefined) return;
  const operation: { error?: string } = {};
  view.operations.set(key, operation);
  actions.refresh();
  try {
    const result = await actions.command(command);
    if (!result.ok) operation.error = result.error;
  } catch {
    operation.error = "Puck could not complete that action. Try again.";
  }
  if (operation.error === undefined) view.operations.delete(key);
  actions.refresh();
}

function action(
  state: DesktopState, view: ViewModel, actions: WorkspaceActions,
  key: string, label: string, pendingLabel: string, command: WorkspaceCommand,
) {
  const status = view.operations.get(key);
  const pending = status !== undefined && status.error === undefined;
  const control = button(
    pending ? pendingLabel : label,
    () => void run(view, key, command, actions),
  );
  control.id = `activity-action-${key}`;
  control.disabled = pending || state.connection !== "online";
  const group = element("div", "activity-action stack", control);
  if (status?.error) group.append(notice(status.error, true));
  return group;
}

function look(state: DesktopState, botId: string, botName: string, colourHint?: string | null) {
  const bot = state.workspace?.bots?.find(item => item.botId === botId);
  return botAppearance(botId, botName, bot?.colour ?? colourHint, bot?.shape);
}

function row(
  state: DesktopState, item: { botId: string; botName: string; title: string; at: number; colour?: string | null },
  id: string, summary: string, tone: "neutral" | "ok" | "bad", open: () => void, sleeping = false,
) {
  const bot = look(state, item.botId, item.botName, item.colour);
  const entry = element("button", "activity-row row",
    avatar(bot.colour, bot.shape, 36, sleeping, bot.tilt),
    element("span", "activity-row-copy grow",
      element("span", "activity-meta muted", item.botName),
      element("strong", "", item.title),
      element("span", `activity-${tone}`, summary)),
    alertTime(item.at));
  setBotTheme(entry, bot.colour);
  entry.type = "button";
  entry.id = `activity-row-${id}`;
  entry.onclick = open;
  return entry;
}

export function openReceipt(state: DesktopState, questionId: string, actions: WorkspaceActions): void {
  openDetail(viewModel(state), "archive", questionId, actions);
}

function statusLine(copy: string) {
  const node = element("p", "muted", copy);
  node.setAttribute("role", "status");
  return node;
}

export function renderArchive(state: DesktopState, actions: WorkspaceActions): HTMLElement {
  const view = viewModel(state);
  const workspace = state.workspace;
  const main = root();
  const back = () => showSelection(view, "archive", undefined, actions);
  const selection = view.archive;
  if (selection?.kind === "alert") {
    return alertDetail(main, state, view, selection.id, actions, back, "Archive");
  }
  if (selection?.kind === "task") {
    const task = workspace?.archivedTasks?.find(item => item.activityId === selection.id);
    main.append(detailNav("Archive", back), heading("Task"));
    if (task) main.append(taskTimeline(state, task));
    else main.append(statusLine("This task is no longer in the archive."));
    return main;
  }

  delete view.archive;
  const filter = element("select");
  filter.id = "activity-filter";
  filter.setAttribute("aria-label", "Filter archive");
  for (const key of Object.keys(FILTERS) as Filter[]) {
    filter.add(new Option(FILTERS[key], key, false, view.filter === key));
  }
  filter.onchange = () => {
    view.filter = filter.value as Filter;
    actions.refresh();
  };
  main.append(element("header", "activity-toolbar row wrap spread", heading("Archive"), filter));

  const selectedFilter = view.filter;
  const history = workspace?.history;
  const historyItems = history?.items ?? [];
  const tasks = workspace?.archivedTasks ?? [];
  const showAlerts = selectedFilter !== "tasks";
  const showTasks = selectedFilter === "all" || selectedFilter === "tasks";
  const items = selectedFilter === "failed" ? historyItems.filter(item => item.deliveryStatus === "failed") : historyItems;
  const groups = new Map<string, HTMLUListElement>();
  const now = Date.now();
  const alertEntries = showAlerts ? items.map(item => ({
    at: item.answeredAt ?? item.createdAt,
    row: () => archivedAlertRow(state, view, item, actions),
  })) : [];
  const oldestAlert = history?.hasMore && selectedFilter === "all" && alertEntries.length
    ? Math.min(...alertEntries.map(item => item.at)) : -Infinity;
  const taskEntries = showTasks ? tasks.filter(task => task.endedAt >= oldestAlert).map(task => ({
    at: task.endedAt,
    row: () => {
      const summary = taskSummary(task);
      return row(state, { ...task, at: task.endedAt }, task.activityId, summary.detail, summary.tone,
        () => showSelection(view, "archive", { kind: "task", id: task.activityId }, actions));
    },
  })) : [];
  const errors = workspace?.errors;
  if (showAlerts && errors?.history) main.append(notice(errors.history, true));
  if (showTasks && errors?.archivedTasks) main.append(notice(errors.archivedTasks, true));
  for (const entry of [...alertEntries, ...taskEntries].sort((a, b) => b.at - a.at)) {
    const day = dayLabel(entry.at, now);
    let list = groups.get(day);
    if (!list) {
      list = element("ul", "activity-list");
      groups.set(day, list);
      main.append(section(day, list));
    }
    list.append(element("li", "", entry.row()));
  }

  const loading = (showAlerts && !history && !errors?.history) ||
    (showTasks && !workspace?.archivedTasks && !errors?.archivedTasks);
  if (loading) main.append(statusLine(state.connection === "offline" ? "Archive resumes loading when Puck reconnects." : "Loading archive…"));
  else if (groups.size === 0 && !(showAlerts && errors?.history) && !(showTasks && errors?.archivedTasks)) {
    main.append(statusLine(history?.hasMore && showAlerts ? "No matches in the alerts loaded so far." : "Nothing in this view yet."));
  }
  if (showAlerts && (history?.hasMore || errors?.history)) {
    main.append(action(state, view, actions, "history", history?.hasMore ? "Load more" : "Try loading alerts again",
      "Loading…", { type: "loadHistory" }));
  }
  return main;
}

function detailNav(backLabel: string, back: () => void) {
  const control = button(`‹ ${backLabel}`, back, "quiet");
  control.id = "activity-back";
  return element("div", "", control);
}

function hero(
  state: DesktopState, item: { botId: string; botName: string; colour?: string | null },
  title: string, at: number, message?: string | null,
) {
  const bot = look(state, item.botId, item.botName, item.colour);
  const identity = element("div", "identity row wrap",
    avatar(bot.colour, bot.shape, 39, false, bot.tilt), element("strong", "", item.botName), alertTime(at));
  const header = element("header", "alert-header", identity, element("h2", "", title));
  setBotTheme(header, bot.colour);
  if (message) header.append(element("p", "", message));
  return header;
}

function timelineRow(label: string, time: string, tone: string, isNote = false) {
  return element("li", `activity-timeline-row activity-${tone}${isNote ? " activity-timeline-note" : ""}`,
    element("span", "", label), element("span", "muted", time));
}

function archivedAlertRow(state: DesktopState, view: ViewModel, item: HistoryItem, actions: WorkspaceActions) {
  const failed = item.deliveryStatus === "failed";
  const reply = item.picks.join(", ") || (item.customReply ? `“${item.customReply}”` : item.hasAttachments ? "a file" : "a reply");
  const summary = item.outcome === "answered" ? `You: ${reply}${failed ? " · Not delivered" : ""}`
    : item.outcome === "cancelled" ? "Cancelled" : "Missed";
  const tone = failed ? "bad" : item.deliveryStatus === "delivered" ? "ok" : "neutral";
  return row(state, { ...item, title: item.question, at: item.answeredAt ?? item.createdAt },
    item.questionId, summary, tone, () => openDetail(view, "archive", item.questionId, actions));
}

function dayLabel(at: number, now: number) {
  const date = new Date(at);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return "Today";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function snoozeNote(until: number | null, now: number) {
  if (until === null) return "Snoozed until you’re back";
  const minutes = Math.ceil((until - now) / 60_000);
  if (minutes <= 0) return "Due back now";
  return minutes <= 60 ? `Back in ${minutes} min` : `Back at ${alertTime(until).title}`;
}

function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}

function stepChanges(task: ArchivedTask) {
  let current = "";
  const changes = new Map<number, number>();
  let previous: number | undefined;
  for (const [index, mark] of task.history.entries()) {
    if (!mark.step || mark.step === current) continue;
    if (previous !== undefined) changes.set(previous, mark.at);
    changes.set(index, task.endedAt);
    current = mark.step;
    previous = index;
  }
  return changes;
}

function taskSummary(task: ArchivedTask) {
  const label = task.state === "done" ? "Done" : task.state === "failed" ? "Failed" : "Stopped";
  const tone = task.state === "done" ? "ok" : task.state === "failed" ? "bad" : "neutral";
  const count = stepChanges(task).size;
  const countLabel = count ? ` · ${count} ${count === 1 ? "step" : "steps"}` : "";
  return { label, tone, detail: `${label}${countLabel} · ${durationLabel(task.endedAt - task.startedAt)}` } as const;
}

const clockWithSeconds = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

function taskTimeline(state: DesktopState, task: ArchivedTask) {
  const summary = taskSummary(task);
  const steps = element("ol", "activity-timeline", timelineRow("Started", clockWithSeconds.format(task.startedAt), "neutral"));
  const changes = stepChanges(task);
  for (const [index, mark] of task.history.entries()) {
    const time = clockWithSeconds.format(mark.at);
    const end = changes.get(index);
    if (end !== undefined) steps.append(timelineRow(mark.step, `${time} · ${durationLabel(end - mark.at)}`, "neutral"));
    if (mark.note) steps.append(timelineRow(mark.note, time, "neutral", true));
  }
  steps.append(timelineRow(summary.label, clockWithSeconds.format(task.endedAt), summary.tone));
  const detail = element("article", "stack",
    hero(state, task, task.title, task.endedAt, task.note),
    element("p", `activity-${summary.tone}`, summary.detail),
    section("Timeline", steps));
  const reached = new Set(task.history.map((mark: { step: string }) => mark.step));
  const planned: readonly string[] = task.steps ?? [];
  const missed = planned.filter(step => !reached.has(step));
  if (missed.length) detail.append(section("Not reached",
    element("ul", "activity-list", ...missed.map(step => element("li", "muted", step)))));
  return detail;
}

function alertDetail(
  main: HTMLElement, state: DesktopState, view: ViewModel, id: string, actions: WorkspaceActions,
  back: () => void, backLabel: string,
) {
  main.append(detailNav(backLabel, back), heading("Alert"));
  const workspace = state.workspace;
  const detail = workspace?.detail?.questionId === id ? workspace.detail : undefined;
  if (detail?.alert) {
    main.append(alertBody(state, view, detail.alert, actions));
  } else {
    const key = `detail-${id}`;
    const actionError = view.operations.get(key)?.error;
    const queryError = workspace?.errors?.detail;
    if (actionError || queryError) {
      if (queryError && !actionError) main.append(notice(queryError, true));
      main.append(action(state, view, actions, key, "Try again", "Loading…", { type: "loadDetail", questionId: id }));
    } else {
      const loading = state.connection === "offline" ? "Alert loads when Puck reconnects." : "Loading alert…";
      main.append(statusLine(detail === undefined ? loading : "This alert is gone."));
    }
  }
  return main;
}

function alertBody(state: DesktopState, view: ViewModel, alert: AlertDetail, actions: WorkspaceActions) {
  const id = alert.questionId;
  const now = Date.now();
  const bot = look(state, alert.botId, alert.botName);
  const body = element("article", "stack", hero(state, alert, alert.question, alert.createdAt, alert.message));
  setBotTheme(body, bot.colour);
  const latest = alert.snoozes.at(-1);
  if (!alert.answer) {
    const status = alert.status === "snoozed" ? snoozeNote(latest?.until ?? null, now)
      : alert.status === "cancelled" ? "Cancelled"
      : alert.timeline.some(event => event.kind === "missed") ? "Missed"
      : alert.status === "scheduled" ? "Scheduled" : "Unanswered";
    body.append(element("p", "kicker", status));
  }
  if (alert.details) {
    const summary = element("summary", "", "Details");
    summary.id = `activity-summary-${id}`;
    const details = element("details", "more", summary, element("p", "", alert.details));
    details.open = view.expandedDetails.has(id);
    details.ontoggle = () => {
      if (details.open) view.expandedDetails.add(id);
      else view.expandedDetails.delete(id);
    };
    body.append(details);
  }
  if (alert.link) body.append(action(state, view, actions, `link-${id}`, alert.link.label, "Opening…",
    { type: "openDetailLink", questionId: id }));
  if (alert.options.length) {
    const choices = element("ul", "activity-list stack");
    for (const option of alert.options) {
      const row = element("li", `activity-option row spread${option.chosen ? " is-picked" : ""}`,
        element("div", "", element("strong", "", option.label), ...(option.desc ? [element("p", "muted", option.desc)] : [])));
      if (option.chosen) row.append(element("span", "activity-picked", "✓ Picked"));
      choices.append(row);
    }
    body.append(section("Options", choices));
  }

  const savedForPickup = alert.delivery?.state === "delivered" && alert.delivery.attempts === 0;
  if (alert.answer) {
    const answer = alert.answer;
    const receipt = section("Reply", element("p", "muted row wrap",
      answer.answeredByClientName ? `Answered on ${answer.answeredByClientName}` : "You answered",
      alertTime(answer.answeredAt)));
    if (answer.picks.length) receipt.append(element("p", "", answer.picks.join(", ")));
    if (answer.customReply) receipt.append(element("blockquote", "activity-quote", answer.customReply));
    if (answer.attachments.length) {
      receipt.append(element("ul", "activity-files activity-list row wrap",
        ...answer.attachments.map(file => element("li", "", file.name, element("span", "muted", formatBytes(file.size))))));
    }
    if (savedForPickup) {
      receipt.append(element("p", "activity-ok", "Saved for the bot to read"));
    } else if (alert.delivery) {
      const delivery = alert.delivery;
      const line = receiptLine(delivery.state === "pending" ? "sending" : delivery.state,
        alert.botName, { exhausted: delivery.state === "failed" });
      receipt.append(element("p", line.tone === "warn" ? "activity-bad" : line.tone === "ok" ? "activity-ok" : "muted", line.text));
      if (delivery.state === "failed") {
        if (delivery.lastError) receipt.append(element("p", "muted", delivery.lastError));
        receipt.append(action(state, view, actions, `retry-${id}`, "Try again", "Retrying…",
          { type: "retryDelivery", answerId: answer.answerId }));
      }
    }
    body.append(receipt);
  }

  if (alert.timeline.length) {
    const history = element("ol", "activity-timeline");
    for (const event of alert.timeline) {
      if (savedForPickup && event.kind === "delivered") continue;
      const clock = alertTime(event.at);
      const day = dayLabel(event.at, now);
      const time = day === "Today" ? clock.textContent : clock.title;
      const tone = event.kind === "failed" || event.kind === "missed" ? "bad"
        : event.kind === "answered" || event.kind === "delivered" ? "ok" : "neutral";
      history.append(timelineRow(event.text, time ?? "", tone));
    }
    body.append(section("Timeline", history));
  }
  return body;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

export function renderHomeActivity(state: DesktopState, actions: WorkspaceActions): HTMLElement {
  const view = viewModel(state);
  const main = root();
  const workspace = state.workspace;
  const selection = view.home;
  if (selection) {
    return alertDetail(main, state, view, selection.id, actions,
      () => showSelection(view, "home", undefined, actions), "Home");
  }
  main.append(heading("Home"));
  const pairing = workspace?.pairing ?? [];
  const live = workspace?.live ?? [];
  const waiting = workspace?.waiting ?? [];
  if (state.connection === "online" && workspace?.waiting && workspace.live && workspace.pairing &&
    !state.alerts.length && !waiting.length && !live.length && !pairing.length && !workspace.errors.waiting && !workspace.errors.live && !workspace.errors.pairing) {
    main.append(empty("All quiet", "Nothing is waiting for your response."));
    return main;
  }

  if (workspace?.errors.waiting) main.append(notice(workspace.errors.waiting, true));
  if (workspace?.errors.live) main.append(notice(workspace.errors.live, true));
  if (workspace?.errors.pairing) main.append(notice(workspace.errors.pairing, true));

  const now = Date.now();
  const incoming = element("ul", "activity-list need-list");
  for (const alert of state.alerts) {
    const summary = alert.priority === "urgent" ? "Urgent · Unanswered" : "Unanswered";
    incoming.append(element("li", "", row(state, {
      ...alert, title: alert.question, at: alert.createdAt, colour: alert.botColour,
    }, alert.questionId, summary, alert.priority === "urgent" ? "bad" : "neutral", () => actions.openAlert(alert.questionId))));
  }
  if (state.alerts.length) main.append(section("Needs you", incoming));
  else if (!workspace?.waiting && !workspace?.errors.waiting) main.append(statusLine("Checking for alerts…"));

  if (pairing.length) {
    main.append(section("Pairing requests",
      element("div", "row wrap", element("p", "muted", pairing.length === 1 ? "A bot is waiting to pair."
        : `${pairing.length} bots are waiting to pair.`), button("Review in Bots", () => actions.navigate("bots")))));
  }

  if (live.length) main.append(section("Working now", ...live.map(task => activeTask(state, view, task, actions, now))));

  const snoozed = waiting.filter(alert => alert.status === "snoozed" && (alert.expiresAt === null || alert.expiresAt > now));
  if (snoozed.length) {
    const list = element("ul", "activity-list");
    for (const alert of snoozed) {
      list.append(element("li", "", row(state, {
        ...alert, title: alert.question, at: alert.createdAt,
      }, alert.questionId, snoozeNote(alert.snoozedUntil, now), "neutral",
      () => openDetail(view, "home", alert.questionId, actions), true)));
    }
    const waiting = section("Waiting", list);
    if (snoozed.some(alert => alert.snoozedUntil === null)) {
      waiting.append(action(state, view, actions, "wake", "Wake untimed snoozes from this Mac", "Waking…", { type: "wake" }));
    }
    main.append(waiting);
  }
  return main;
}

function activeTask(state: DesktopState, view: ViewModel, task: LiveTask, actions: WorkspaceActions, now: number) {
  const bot = look(state, task.botId, task.botName, task.colour);
  const elapsed = now - task.startedAt;
  const copy = elapsed < 60_000 ? "Just started" : durationLabel(elapsed);
  const card = element("article", "activity-live stack",
    element("header", "row",
      avatar(bot.colour, bot.shape, 37, false, bot.tilt),
      element("div", "grow",
        element("p", "activity-meta muted", task.botName),
        element("h3", "", task.title)),
      element("span", "badge", copy)));
  setBotTheme(card, bot.colour);

  if (task.steps?.length && task.stepIndex !== null) {
    const index = Math.max(0, Math.min(task.stepIndex, task.steps.length - 1));
    const progress = element("progress", "activity-progress");
    progress.value = index;
    progress.max = task.steps.length;
    progress.setAttribute("aria-label", `${task.steps[index] ?? "Working"} · Step ${index + 1} of ${task.steps.length}`);
    const steps = element("ol", "activity-steps");
    for (const [position, step] of task.steps.entries()) {
      const entry = element("li", position < index ? "activity-ok" : position === index ? "is-current" : "muted",
        position < index ? `✓ ${step}` : step);
      if (position === index) entry.setAttribute("aria-current", "step");
      steps.append(entry);
    }
    card.append(progress, steps);
  } else {
    const lines = element("ul", "activity-list activity-log");
    for (const step of task.log.slice(-2)) lines.append(element("li", "muted", `✓ ${step}`));
    if (task.currentStep && task.currentStep !== task.log.at(-1)) lines.append(element("li", "", task.currentStep));
    if (lines.childElementCount) card.append(lines);
  }

  if (task.note) card.append(element("p", "activity-note muted", task.note));
  if (task.link) card.append(action(state, view, actions, `task-link-${task.activityId}`, task.link.label, "Opening…",
    { type: "openTaskLink", activityId: task.activityId }));
  return card;
}
