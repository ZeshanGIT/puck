import { NOTICE_REPLY } from "@puck/client";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "@puck/shared";
import type { DesktopAlert, DesktopAttachment, DesktopRPC } from "../protocol";
import { alertTime, avatar, botAppearance, button, element, notice, setBotTheme } from "./elements";

type AnswerParams = DesktopRPC["bun"]["requests"]["answer"]["params"];

export interface Draft {
  optionIds: string[];
  attachments: DesktopAttachment[];
  text: string;
  snoozeMinutes: number | null;
  detailsOpen: boolean;
  confirmation: AnswerParams | null;
}

export function newDraft(): Draft {
  return { optionIds: [], attachments: [], text: "", snoozeMinutes: 10, detailsOpen: false, confirmation: null };
}

interface ReplyActions {
  answer: (params: AnswerParams) => void;
  chooseAttachments: (selectedIds: string[]) => void;
  snooze: (minutes: number | null) => void;
  openLink: () => void;
  refresh: (focus?: string) => void;
}

export function replyEditor(
  alert: DesktopAlert,
  draft: Draft,
  actions: ReplyActions,
  blocked: string | null,
  busy: boolean,
) {
  const root = element("article", "");
  const { colour, shape, tilt } = botAppearance(alert.botId, alert.botName, alert.botColour, alert.botShape);
  setBotTheme(root, colour);
  const identity = element(
    "div", "identity row wrap", avatar(colour, alert.botShape ?? "round", 38, false, 0, true),
    element("strong", "", alert.botName), alertTime(alert.createdAt),
  );
  if (alert.priority === "urgent") identity.append(element("span", "badge urgent", "Urgent"));
  const header = element("header", "alert-header", identity, element("h1", "", alert.question));
  if (alert.message) header.append(element("p", "", alert.message));
  root.append(header);

  const form = element("form", "reply-form stack");
  root.append(form);
  if (alert.details) {
    const details = element("details", "more", element("summary", "", "Details"), element("p", "", alert.details));
    details.querySelector("summary")!.id = "alert-details-summary";
    details.open = draft.detailsOpen;
    details.ontoggle = () => { draft.detailsOpen = details.open; };
    form.append(details);
  }
  if (alert.link) {
    const link = button(alert.link.label, actions.openLink);
    link.id = "alert-link";
    link.disabled = busy;
    form.append(element("div", "", link));
  }

  const locked = blocked !== null || busy;
  const multi = alert.selectionMode === "multi";
  const choices = alert.options.length > 0 ? element(
    "fieldset", "", element("legend", "kicker", multi ? "Choose any" : "Choose one"),
  ) : null;
  if (choices) {
    const list = element("div", "choices");
    choices.disabled = busy || draft.confirmation !== null;
    for (const [index, option] of alert.options.entries()) {
      const input = element("input");
      input.type = multi ? "checkbox" : "radio";
      input.name = "choice";
      input.id = `choice-${index}`;
      input.checked = draft.optionIds.includes(option.id);
      input.onchange = () => {
        if (multi) {
          draft.optionIds = input.checked ? [...draft.optionIds, option.id] : draft.optionIds.filter(id => id !== option.id);
        } else {
          draft.optionIds = [option.id];
        }
        update();
      };
      const name = element("span", "choice-name row wrap", option.label);
      if (option.rec) name.append(element("span", "suggested", "Suggested"));
      if (option.tone === "destructive") name.append(element("span", "risky", "Destructive"));
      const copy = element("span", "grow", name);
      if (option.desc) copy.append(element("span", "choice-description", option.desc));
      list.append(element("label", "choice", input, copy));
    }
    choices.append(list);
    form.append(choices);
  }

  const text = element("input");
  text.type = "text";
  text.className = "reply-input";
  text.maxLength = 2000;
  text.id = "reply-text";
  text.value = draft.text;
  text.disabled = busy || draft.confirmation !== null;
  text.placeholder = "Type a message";
  text.autocomplete = "off";
  text.oninput = () => { draft.text = text.value; update(); };
  text.onkeydown = event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  };
  form.append(element("label", "reply-label", choices ? "Add a message" : "Reply", text));

  const files = element("section", "reply-files stack");
  files.setAttribute("aria-label", "Reply attachments");
  const attach = button("Attach file", () => actions.chooseAttachments(draft.attachments.map(file => file.id)));
  attach.id = "attach-files";
  attach.disabled = locked || draft.confirmation !== null || draft.attachments.length >= MAX_ATTACHMENTS;
  const limits = element("span", "muted attachment-limits",
    `Up to ${MAX_ATTACHMENTS} files · ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB each`);
  files.append(element("div", "row wrap", attach, limits));
  if (draft.attachments.length) {
    const list = element("ul", "attachment-list row wrap");
    const sizes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
    for (const [index, file] of draft.attachments.entries()) {
      const remove = button("×", () => {
        draft.attachments = draft.attachments.filter(item => item.id !== file.id);
        actions.refresh("attach-files");
      }, "quiet remove-file");
      remove.id = `remove-file-${index}`;
      remove.disabled = busy || draft.confirmation !== null;
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      const size = file.size >= 1024 * 1024 ? `${sizes.format(file.size / (1024 * 1024))} MB`
        : file.size >= 1024 ? `${sizes.format(file.size / 1024)} KB` : `${file.size} B`;
      list.append(element("li", "attachment-chip row",
        element("span", "", file.name), element("small", "muted", size), remove));
    }
    files.append(list);
  }
  form.append(files);

  const duration = element("select");
  duration.id = "snooze-duration";
  duration.setAttribute("aria-label", "Snooze duration");
  for (const minutes of [5, 10, 30, 60]) {
    const option = element("option", "", minutes === 60 ? "1 hour" : `${minutes} min`);
    option.value = String(minutes);
    duration.append(option);
  }
  duration.add(new Option("Until I’m back", "back"));
  duration.value = draft.snoozeMinutes === null ? "back" : String(draft.snoozeMinutes);
  duration.onchange = () => { draft.snoozeMinutes = duration.value === "back" ? null : Number(duration.value); };

  const snooze = button("Snooze", () => actions.snooze(draft.snoozeMinutes));
  snooze.id = "snooze";
  const send = element("button", "btn primary");
  send.id = "send-reply";
  send.type = "submit";
  send.title = "Send reply (Command + Return while typing)";
  const footer = element("div", "row spread wrap", element("div", "snooze", duration, snooze), send);

  function update() {
    const optionIds = alert.options.filter(option => draft.optionIds.includes(option.id)).map(option => option.id);
    const message = draft.text.trim();
    const hasReply = Boolean(message || optionIds.length || draft.attachments.length);
    send.textContent = !choices && !hasReply ? NOTICE_REPLY : "Send reply";
    send.disabled = locked || draft.confirmation !== null || Boolean(choices && !hasReply);
    duration.disabled = snooze.disabled = locked || draft.confirmation !== null;
  }

  form.onsubmit = event => {
    event.preventDefault();
    if (locked || send.disabled || draft.confirmation) return;
    const selected = alert.options.filter(option => draft.optionIds.includes(option.id));
    const attachmentIds = draft.attachments.map(file => file.id);
    const text = draft.text.trim() || (choices || attachmentIds.length ? undefined : NOTICE_REPLY);
    const params: AnswerParams = {
      questionId: alert.questionId,
      optionIds: selected.map(option => option.id),
      ...(text ? { customReply: text } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
    };
    if (alert.requiresUnlock || selected.some(option => option.tone === "destructive")) {
      draft.confirmation = { ...params, confirmDestructive: true };
      actions.refresh("cancel-confirmation");
    } else {
      actions.answer(params);
    }
  };
  update();
  if (blocked) form.append(notice(blocked));
  const confirmation = draft.confirmation;
  if (confirmation) {
    const labels = alert.options
      .filter(option => confirmation.optionIds.includes(option.id))
      .map(option => option.label).join(", ");
    const cancel = button("Go back", () => {
      draft.confirmation = null;
      actions.refresh("send-reply");
    });
    cancel.id = "cancel-confirmation";
    cancel.disabled = busy;
    const confirm = button("Confirm and send", () => actions.answer(confirmation), "primary");
    confirm.id = "confirm-reply";
    confirm.disabled = locked;
    const risky = alert.options.some(option =>
      option.tone === "destructive" && confirmation.optionIds.includes(option.id));
    const prompt = element("section", "confirmation stack",
      element("h2", "", risky ? "Confirm destructive choice" : "Confirm reply"),
      element("p", "muted", labels || "This alert requires confirmation before sending."),
      element("div", "row wrap", cancel, confirm),
    );
    prompt.setAttribute("aria-label", "Confirm reply");
    form.append(prompt);
  } else {
    form.append(footer);
  }
  return root;
}
