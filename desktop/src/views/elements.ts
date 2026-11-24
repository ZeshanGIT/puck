import { SHAPES, botTheme, isPaletteName, type PaletteName } from "@puck/appearance";

export const darkMode = matchMedia("(prefers-color-scheme: dark)");

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

export function avatar(colour: PaletteName, shape: string, size: number, sleeping = false): SVGElement {
  const theme = botTheme({ colour }, { dark: darkMode.matches });
  const path = Object.hasOwn(SHAPES, shape) ? SHAPES[shape as keyof typeof SHAPES] : SHAPES.round;
  const icon = svgPart("svg", {
    viewBox: "0 0 100 100", width: String(size), height: String(size),
    "aria-hidden": "true", focusable: "false",
  });
  icon.append(svgPart("path", {
    d: path, fill: theme.blobFill, stroke: theme.blobOutline ?? "none", "stroke-width": "2",
  }));
  const ink = ["mustard", "green", "tangerine", "rose", "sky", "brown", "teal", "moss"].includes(colour)
    ? "#221c19" : "#fffaf6";
  if (sleeping) {
    icon.append(svgPart("path", {
      d: "M31 49q6 7 12 0m14 0q6 7 12 0", fill: "none",
      stroke: ink, "stroke-width": "4", "stroke-linecap": "round",
    }));
  } else {
    for (const x of ["37", "63"]) {
      icon.append(svgPart("ellipse", { cx: x, cy: "47", rx: "4.5", ry: "6", fill: ink }));
    }
  }
  icon.append(svgPart("path", {
    d: "M45 61q5 4 10 0", fill: "none",
    stroke: ink, "stroke-width": "3.5", "stroke-linecap": "round",
  }));
  return icon;
}

export function colourFor(value: unknown): PaletteName {
  return typeof value === "string" && isPaletteName(value) ? value : "coral";
}

export function setBotTheme(node: HTMLElement, colour: PaletteName) {
  const theme = botTheme({ colour }, { dark: darkMode.matches });
  node.style.setProperty("--bot-wash", theme.botWash);
  node.style.setProperty("--bot-ink", theme.botInk);
  node.style.setProperty("--bot-mark", theme.mark);
}

export function brand() {
  return element("div", "brand row", avatar("coral", "squircle", 26), "Puck");
}

export function empty(title: string, description: string, action?: HTMLElement) {
  const node = element(
    "section", "empty", avatar("coral", "squircle", 66, true),
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
