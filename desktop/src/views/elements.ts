import {
  EYES, EYE_GROUP_ORIGIN, EYE_GROUP_ROTATION, SAMPLE_BOTS, SHAPES, botLook, botTheme, darkTokens,
  ensureContrast, isPaletteName, lightTokens, over, radii, themeIsDark, washGradientCss,
  type PaletteName, type ShapeName, type ThemePreference,
} from "@puck/appearance";

export const darkMode = matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(preference: ThemePreference = "system") {
  const dark = themeIsDark(preference, darkMode.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = root.dataset.theme;
  for (const [key, value] of Object.entries(dark ? darkTokens : lightTokens)) {
    root.style.setProperty(`--puck-${key}`, value);
  }
  for (const [key, value] of Object.entries(radii)) {
    root.style.setProperty(`--radius-${key}`, `${value}px`);
  }
}

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

export function element<T extends keyof HTMLElementTagNameMap>(
  tag: T,
  className = "",
  ...content: Array<Node | string>
): HTMLElementTagNameMap[T] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...content);
  return node;
}

export function button(
  label: string,
  action: () => void,
  style = "",
): HTMLButtonElement {
  const node = element("button", `btn ${style}`, label);
  node.type = "button";
  node.onclick = action;
  return node;
}

function svgPart(tag: string, attributes: Record<string, string>): SVGElement {
  const part = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) part.setAttribute(name, value);
  return part;
}

export function avatar(
  colour: PaletteName, shape: string, size: number, sleeping = false, tilt = 0, ring = false,
): SVGElement {
  const theme = botTheme({ colour }, { dark: isDark() });
  const path = Object.hasOwn(SHAPES, shape) ? SHAPES[shape as keyof typeof SHAPES] : SHAPES.round;
  const icon = svgPart("svg", {
    viewBox: "0 0 100 100", width: String(size), height: String(size),
    "aria-hidden": "true", focusable: "false",
  });
  const body = svgPart("path", {
    d: path, fill: theme.blobFill,
    stroke: theme.blobOutline ?? (ring ? "var(--puck-avatarRing)" : "none"),
    "stroke-width": theme.blobOutline ? "2" : "4",
    transform: `rotate(${tilt} 50 50)`,
  });
  const eyes = svgPart("g", {
    transform: `rotate(${EYE_GROUP_ROTATION} ${EYE_GROUP_ORIGIN.x} ${EYE_GROUP_ORIGIN.y})`,
  });
  for (const eye of EYES) {
    eyes.append(svgPart("rect", {
      x: String(sleeping ? eye.x - 0.5 : eye.x),
      y: String(sleeping ? eye.y + eye.height / 2 + 2 : eye.y),
      width: String(sleeping ? eye.width + 1 : eye.width),
      height: String(sleeping ? 3.2 : eye.height),
      rx: String(sleeping ? 1.6 : eye.rx),
      fill: "#fff",
    }));
  }
  icon.append(body, eyes);
  return icon;
}

function puckAvatar(size: number, sleeping = false) {
  const { colour, shape, tilt } = SAMPLE_BOTS.puck;
  return avatar(colour, shape, size, sleeping, tilt);
}

export function navigationIcon(page: "home" | "bots" | "archive" | "settings") {
  const paths = {
    home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    bots: "M8 4.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4zm6.5 1.7h4a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM12 14.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z",
    archive: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.4v4.3h4.3M12 7.8V12l2.9 1.8",
    settings: "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1zM15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0z",
  };
  const icon = svgPart("svg", {
    width: "19", height: "19", viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round",
    "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
  });
  icon.append(svgPart("path", { d: paths[page] }));
  return icon;
}

export function botAppearance(botId: string, botName: string, colour?: string | null, shape?: string | null) {
  return botLook({
    botId,
    botName,
    colour: colour && isPaletteName(colour) ? colour : undefined,
    shape: shape && Object.hasOwn(SHAPES, shape) ? shape as ShapeName : undefined,
  });
}

export function colourFor(value: unknown): PaletteName {
  return typeof value === "string" && isPaletteName(value) ? value : "coral";
}

export function setBotTheme(node: HTMLElement, colour: PaletteName) {
  const dark = isDark();
  const tokens = dark ? darkTokens : lightTokens;
  const theme = botTheme({ colour }, { dark });
  const washed = over(theme.botWash, tokens.card);
  const direction = dark ? "lighten" : "darken";
  node.style.setProperty("--bot-wash", theme.botWash);
  node.style.setProperty("--bot-gradient", washGradientCss(theme.botWash, "to right", 70));
  node.style.setProperty("--bot-ink", ensureContrast(theme.botInk, [tokens.card, washed], 4.5, direction));
  node.style.setProperty("--bot-muted", ensureContrast(tokens.ink2, [tokens.card, washed], 4.5, direction));
  node.style.setProperty("--bot-mark", theme.mark);
}

export function brand() {
  return element("div", "brand row", puckAvatar(28), "Puck");
}

export function empty(title: string, description: string, action?: HTMLElement) {
  const node = element(
    "section", "empty", puckAvatar(76, true),
    element("h1", "", title), element("p", "muted", description),
  );
  if (action) node.append(action);
  return node;
}

export function notice(copy: string, error = false) {
  return element("p", error ? "notice" : "notice info", copy);
}

export function clock(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value);
}

const fullDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function alertTime(value: number): HTMLTimeElement {
  const today = new Date().toDateString() === new Date(value).toDateString();
  const time = element("time", "", today ? clock(value) : dateFormat.format(value));
  time.dateTime = new Date(value).toISOString();
  time.title = fullDateFormat.format(value);
  return time;
}
