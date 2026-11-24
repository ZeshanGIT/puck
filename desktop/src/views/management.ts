import type { BotCatalogItem } from "@puck/client";
import type { DesktopResult, DesktopState } from "../protocol";
import type { WorkspaceCommand } from "../workspaceProtocol";
import type { WorkspaceActions } from "./workspaceActions";
import { PALETTE, SHAPES, THEME_CHOICES, type PaletteName, type ShapeName } from "@puck/appearance";
import { alertTime, avatar, botAppearance, button, colourFor, element, notice } from "./elements";

const COLOURS = PALETTE.map(entry => entry.name);
const SHAPES_BY_NAME = Object.keys(SHAPES) as ShapeName[];
const MUTE_CHOICES = ["hour", "morning", "week"] as const;
const MUTE_LABELS = { hour: "For 1 hour", morning: "Until tomorrow", week: "For a week" };
const SHAPE_LABELS: Partial<Record<ShapeName, string>> = { hex: "Hexagon", squircle: "Rounded square" };
const HOUR = 60 * 60_000;

function muteUntil(choice: (typeof MUTE_CHOICES)[number]): number {
  const now = Date.now();
  if (choice === "hour") return now + HOUR;
  if (choice === "week") return now + 7 * 24 * HOUR;
  const morning = new Date(now);
  morning.setHours(7, 0, 0, 0);
  if (morning.getTime() <= now) morning.setDate(morning.getDate() + 1);
  return morning.getTime();
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function heading(id: string, title: string) {
  const node = element("h1", "", title);
  node.id = id;
  node.tabIndex = -1;
  return node;
}

function section(title: string, ...children: Node[]) {
  return element("section", "stack", element("h2", "", title), ...children);
}

function control(id: string, label: string, callback: () => void, disabled: boolean, style = "") {
  const node = button(label, callback, style);
  node.id = id;
  node.disabled = disabled;
  return node;
}

function submitButton(id: string, label: string, disabled: boolean) {
  const node = element("button", "btn primary", label);
  node.type = "submit";
  node.id = id;
  node.disabled = disabled;
  return node;
}

function field(label: string, input: HTMLElement) {
  return element("label", "reply-label", label, input);
}

function textInput(id: string, value: string, disabled: boolean) {
  const input = element("input", "reply-input");
  input.type = "text";
  input.id = id;
  input.value = value;
  input.disabled = disabled;
  input.required = true;
  return input;
}

function select<T extends string>(
  id: string, values: readonly T[], selected: T, disabled: boolean, label: (value: T) => string = titleCase,
) {
  const input = element("select");
  input.id = id;
  input.disabled = disabled;
  for (const value of values) input.add(new Option(label(value), value, false, value === selected));
  return input;
}

function form(className: string, submit: () => void, ...children: Node[]) {
  const node = element("form", className, ...children);
  node.onsubmit = event => {
    event.preventDefault();
    submit();
  };
  return node;
}

function managementAvatar(bot: { botId: string; name: string; colour: string | null; shape?: string | null }, size: number, muted = false) {
  const { colour, shape, tilt } = botAppearance(bot.botId, bot.name, bot.colour, bot.shape);
  return avatar(colour, shape, size, muted, tilt);
}

function shapeFor(value: string | null | undefined): ShapeName {
  return SHAPES_BY_NAME.find(shape => shape === value) ?? "round";
}

type Page = "bots" | "settings";
type Status = { page: Page; kind: "working" | "success" | "error"; text: string };
type BotDraft = { colour?: PaletteName; shape?: ShapeName };
type Removal = { type: "removeBot"; botId: string } | { type: "removeClient"; clientId: string };

function newDrafts() {
  return {
    bot: new Map<string, BotDraft>(),
    openBot: undefined as string | undefined,
    mute: new Map<string, (typeof MUTE_CHOICES)[number]>(),
    pairingCode: "",
    deviceName: undefined as string | undefined,
    removal: undefined as Removal | undefined,
    status: undefined as Status | undefined,
  };
}

let scope = "";
let drafts = newDrafts();

function management(state: DesktopState, actions: WorkspaceActions, page: Page) {
  const key = JSON.stringify([state.session.status === "ready" ? state.session.account : null, state.workspace?.clientId]);
  if (scope !== key) {
    scope = key;
    drafts = newDrafts();
  }
  const local = drafts;
  const busy = local.status?.kind === "working";
  const disabled = busy || state.connection !== "online" || state.session.status !== "ready";
  const id = `${page}-heading`;
  const pane = element("section", "detail-inner stack management", heading(id, titleCase(page)));
  pane.setAttribute("aria-labelledby", id);
  const status = local.status;
  if (status?.page === page) {
    const message = notice(status.text, status.kind === "error");
    message.setAttribute("role", status.kind === "error" ? "alert" : "status");
    pane.append(message);
  }
  if (state.connection !== "online") {
    pane.append(notice(state.connection === "offline" ? "Account changes resume when Puck reconnects." : "Connecting to Puck…"));
  }

  async function run(action: () => Promise<DesktopResult>, success: string, onSuccess?: () => void) {
    if (local !== drafts || local.status?.kind === "working") return;
    const focusedId = document.activeElement?.id;
    local.status = { page, kind: "working", text: "Working…" };
    actions.refresh();
    try {
      const result = await action();
      if (result.ok) {
        onSuccess?.();
        local.status = { page, kind: "success", text: success };
      } else {
        local.status = { page, kind: "error", text: result.error };
      }
    } catch {
      local.status = { page, kind: "error", text: "Puck could not complete that action. Try again." };
    } finally {
      if (local === drafts) {
        actions.refresh();
        if (document.activeElement === document.body) {
          const focus = focusedId && document.getElementById(focusedId);
          if (focus && !focus.matches(":disabled")) focus.focus({ preventScroll: true });
          else document.getElementById(id)?.focus({ preventScroll: true });
        }
      }
    }
  }

  function command(value: WorkspaceCommand, success: string, onSuccess?: () => void) {
    if (!disabled) void run(() => actions.command(value), success, onSuccess);
  }

  function remove(removal: Removal, targetId: string, name: string, consequence: string) {
    const armed = local.removal?.type === removal.type && (
      local.removal.type === "removeBot" ? local.removal.botId : local.removal.clientId
    ) === targetId;
    const id = `remove-${removal.type}-${targetId}`;
    if (!armed) {
      const trigger = control(id, "Remove", () => {
        local.removal = removal;
        actions.refresh();
        document.getElementById("cancel-confirmation")?.focus();
      }, disabled, "quiet");
      trigger.setAttribute("aria-label", `Remove ${name}`);
      return trigger;
    }
    return element("div", "confirmation stack",
      element("p", "", `Remove ${name}? ${consequence}`),
      element("div", "row wrap",
        control("cancel-confirmation", "Cancel", () => {
          local.removal = undefined;
          actions.refresh();
          document.getElementById(id)?.focus();
        }, busy),
        control(`${id}-confirm`, "Confirm removal", () => {
          command(removal, `Removed ${name}.`, () => {
            local.removal = undefined;
            if (removal.type === "removeBot") {
              local.openBot = undefined;
              local.bot.delete(removal.botId);
              local.mute.delete(removal.botId);
            }
          });
        }, disabled, "primary"),
      ),
    );
  }

  return { pane, local, disabled, busy, command, run, remove };
}

type Management = ReturnType<typeof management>;

function dataset(error: string | undefined, loaded: boolean, emptyMessage: string, count: number): Node[] {
  if (error) return [notice(error, true)];
  if (!loaded) return [element("p", "muted", "Loading…")];
  return count ? [] : [element("p", "muted", emptyMessage)];
}

function botEditor(bot: BotCatalogItem, ui: Management) {
  const id = `bot-${bot.botId}`;
  const draft = ui.local.bot.get(bot.botId) ?? {};
  ui.local.bot.set(bot.botId, draft);
  const look = botAppearance(bot.botId, bot.name, bot.colour, bot.shape);
  const colour = select(`${id}-colour`, COLOURS, draft.colour ?? look.colour, ui.disabled);
  const shape = select(`${id}-shape`, SHAPES_BY_NAME, draft.shape ?? look.shape, ui.disabled,
    value => SHAPE_LABELS[value] ?? titleCase(value));
  const save = submitButton(`${id}-save`, "Save appearance", ui.disabled);
  const preview = element("div", "row");
  function updatePreview() {
    preview.replaceChildren(avatar(colourFor(colour.value), shape.value, 52, false, look.tilt));
    save.disabled = ui.disabled || (draft.colour === undefined && draft.shape === undefined);
  }
  colour.onchange = () => {
    const value = colourFor(colour.value);
    draft.colour = value === look.colour ? undefined : value;
    updatePreview();
  };
  shape.onchange = () => {
    const value = shapeFor(shape.value);
    draft.shape = value === look.shape ? undefined : value;
    updatePreview();
  };
  updatePreview();

  const appearance = form("stack", () => {
    if (save.disabled) return;
    ui.command({ type: "updateBot", botId: bot.botId, ...draft }, "Bot appearance saved.",
      () => ui.local.bot.delete(bot.botId));
  }, preview, element("div", "row wrap", field("Colour", colour), field("Shape", shape)), element("div", "", save));

  const muted = (bot.mutedUntil ?? 0) > Date.now();
  const currentMute = muted && bot.mutedUntil !== null
    ? `Muted until ${new Date(bot.mutedUntil).toLocaleString()}`
    : "Notifications are on";
  const muteChoices = ["off", ...MUTE_CHOICES] as const;
  const selected = select(`${id}-mute-duration`, muteChoices, ui.local.mute.get(bot.botId) ?? "off", ui.disabled,
    value => value === "off" ? "Choose a duration" : MUTE_LABELS[value]);
  const mute = submitButton(`${id}-mute`, "Mute", ui.disabled || selected.value === "off");
  selected.onchange = () => {
    const choice = MUTE_CHOICES.find(value => value === selected.value);
    if (choice) ui.local.mute.set(bot.botId, choice);
    else ui.local.mute.delete(bot.botId);
    mute.disabled = ui.disabled || !choice;
  };
  const muteForm = form("stack", () => {
    const choice = MUTE_CHOICES.find(value => value === selected.value);
    if (choice) ui.command({ type: "updateBot", botId: bot.botId, mutedUntil: muteUntil(choice) }, "Bot muted.",
      () => ui.local.mute.delete(bot.botId));
  }, element("p", "muted", currentMute), element("div", "row wrap",
    field("Mute duration", selected), mute,
    ...(muted ? [control(`${id}-unmute`, "Unmute",
      () => ui.command({ type: "updateBot", botId: bot.botId, mutedUntil: null }, "Bot unmuted."),
      ui.disabled)] : []),
  ));

  return element("div", "stack", appearance, muteForm,
    ui.remove({ type: "removeBot", botId: bot.botId }, bot.botId, bot.name, "Its waiting alerts will be cancelled."));
}

export function renderBots(state: DesktopState, actions: WorkspaceActions) {
  const ui = management(state, actions, "bots");
  const { pane, local, disabled } = ui;
  const workspace = state.workspace;
  const requests = (workspace?.pairing ?? []).filter(request => request.expiresAt > Date.now())
    .sort((a, b) => b.expiresAt - a.expiresAt);
  const paired = [...(workspace?.bots ?? [])].sort((a, b) => b.waitingCount - a.waitingCount ||
    (b.lastAlertAt ?? 0) - (a.lastAlertAt ?? 0) || a.name.localeCompare(b.name));

  const requestCards = requests.map(request => {
    const id = `pairing-${request.botId}`;
    const code = request.pairingCode.replace(/^(\d{3})(\d{3})$/u, "$1 $2");
    return element("article", "confirmation stack",
      element("div", "row",
        managementAvatar(request, 40),
        element("div", "",
          element("h3", "", request.name),
          element("p", "muted", request.addedFrom ?? "Unknown computer"),
        ),
      ),
      element("p", "", "Check that this code matches the one in your terminal: ", element("code", "", code)),
      element("div", "row wrap",
        control(`${id}-approve`, "Approve", () => {
          if (request.expiresAt <= Date.now()) {
            local.status = { page: "bots", kind: "error", text: "This pairing code expired. Request a new one." };
            actions.refresh();
            return;
          }
          ui.command({ type: "pair", pairingCode: request.pairingCode }, "Bot paired.");
        }, disabled, "primary"),
        control(`${id}-reject`, "Reject",
          () => ui.command({ type: "rejectPairing", botId: request.botId }, "Pairing request rejected."), disabled),
      ),
    );
  });

  const code = textInput("pair-bot-code", local.pairingCode, disabled);
  code.inputMode = "numeric";
  code.autocomplete = "off";
  code.oninput = () => {
    code.value = code.value.replace(/\D/gu, "").slice(0, 6);
    local.pairingCode = code.value;
    pair.disabled = disabled || code.value.length !== 6;
  };
  const pair = submitButton("pair-bot-submit", "Pair bot", disabled || code.value.length !== 6);
  const pairForm = form("stack", () => {
    if (pair.disabled) return;
    ui.command({ type: "pair", pairingCode: code.value }, "Bot paired.", () => { local.pairingCode = ""; });
  },
  field("Six-digit code", code), element("div", "", pair));

  const botCards = paired.map(bot => {
    const editing = local.openBot === bot.botId;
    const muted = (bot.mutedUntil ?? 0) > Date.now();
    const edit = control(`edit-bot-${bot.botId}`, editing ? "Close" : "Edit", () => {
      local.openBot = editing ? undefined : bot.botId;
      local.removal = undefined;
      actions.refresh();
    }, ui.busy);
    edit.setAttribute("aria-expanded", String(editing));
    edit.setAttribute("aria-label", editing ? `Close settings for ${bot.name}` : `Edit ${bot.name}`);
    const meta = element("p", "muted");
    meta.append(bot.lastAlertAt === null ? "Hasn’t paged you yet" : "Last paged ",
      ...(bot.lastAlertAt === null ? [] : [alertTime(bot.lastAlertAt)]));
    const card = element("article", "confirmation stack",
      element("div", "row spread wrap",
        element("div", "row",
          managementAvatar(bot, 42, muted),
          element("div", "", element("h3", "", bot.name), meta),
        ),
        element("div", "row wrap",
          ...(muted ? [element("span", "badge", "Muted")] : []),
          ...(bot.waitingCount > 0 ? [element("span", "badge", `${bot.waitingCount} waiting`)] : []),
          edit,
        ),
      ),
    );
    if (editing) card.append(botEditor(bot, ui));
    return card;
  });

  if (requestCards.length || workspace?.errors.pairing) {
    pane.append(section("Pairing requests", ...dataset(workspace?.errors.pairing, !!workspace?.pairing,
      "No pending requests.", requests.length), ...requestCards));
  }
  pane.append(section("Paired bots", ...dataset(workspace?.errors.bots, !!workspace?.bots, "No paired bots yet.", paired.length),
    ...botCards), section("Pair a bot", pairForm));
  return pane;
}

const PLATFORM_LABELS: Record<string, string> = {
  android: "Android", ios: "iOS", macos: "macOS", web: "Web", cli: "CLI",
};

export function renderSettings(state: DesktopState, actions: WorkspaceActions) {
  const ui = management(state, actions, "settings");
  const workspace = state.workspace;
  const account = state.session.status === "ready" ? state.session.account : "Signed out";
  const signOut = control("settings-sign-out", "Sign out", () => {
    void ui.run(() => actions.signOut(), "Signed out.", () => {
      drafts = newDrafts();
      actions.refresh();
    });
  }, ui.busy || state.session.status !== "ready");
  const accountRow = element("div", "confirmation row spread wrap", element("p", "", account), signOut);
  const theme = element("fieldset", "theme-picker", element("legend", "sr-only", "Theme"));
  for (const { id, label } of THEME_CHOICES) {
    const input = element("input", "sr-only");
    input.type = "radio";
    input.name = "appearance-theme";
    input.id = `settings-theme-${id}`;
    input.checked = id === (state.themePreference ?? "system");
    input.disabled = ui.busy;
    input.onchange = () => {
      if (input.checked) void ui.run(() => actions.setThemePreference(id), "Theme saved.");
    };
    theme.append(element("label", "theme-option", input, element("span", "", label)));
  }

  const clients = [...(workspace?.clients ?? [])].sort((a, b) =>
    Number(b.id === workspace?.clientId) - Number(a.id === workspace?.clientId) ||
    b.lastSeenAt - a.lastSeenAt || a.name.localeCompare(b.name));
  const deviceCards = clients.map(client => {
    const current = client.id === workspace?.clientId;
    const device = element("div", "row spread wrap",
      element("div", "grow", element("h3", "", client.name),
        element("p", "muted", PLATFORM_LABELS[client.platform] ?? titleCase(client.platform),
          " · Last seen ", alertTime(client.lastSeenAt))),
    );
    if (!current) {
      const card = element("article", "confirmation stack", device);
      if (workspace?.clientId) {
        card.append(ui.remove({ type: "removeClient", clientId: client.id }, client.id, client.name,
          "It will stop receiving alerts for your account."));
      }
      return card;
    }
    device.append(element("span", "badge", "This Mac"));
    const name = textInput("settings-device-name", ui.local.deviceName ?? client.name, ui.disabled);
    name.maxLength = 80;
    const save = submitButton("settings-device-save", "Save name", true);
    function checkName() {
      const trimmed = name.value.trim();
      save.disabled = ui.disabled || !trimmed || [...trimmed].length > 40 || trimmed === client.name;
    }
    name.oninput = () => {
      ui.local.deviceName = name.value === client.name ? undefined : name.value;
      checkName();
    };
    checkName();
    const rename = form("stack", () => {
      if (save.disabled) return;
      ui.command({ type: "renameClient", clientId: client.id, name: name.value.trim() }, "Device renamed.",
        () => { ui.local.deviceName = undefined; });
    }, field("Device name", name), element("div", "", save));
    return element("article", "confirmation stack", device, rename);
  });

  ui.pane.append(
    section("Account", accountRow),
    section("Appearance", element("div", "confirmation", theme)),
    section("Devices", ...dataset(workspace?.errors.clients, !!workspace?.clients, "No registered devices.", clients.length),
      ...deviceCards),
    section("Alerts", element("div", "confirmation row spread wrap",
      element("p", "muted", "Send a test alert to check delivery to this Mac."),
      control("settings-send-test", "Send test alert",
        () => ui.command({ type: "sendTest" }, "Test alert sent."), ui.disabled),
    )),
  );
  return ui.pane;
}
