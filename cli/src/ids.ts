const OPTION_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/u;

/** Stable id for a choice label. The same label always produces the same id. */
export function optionIdFromLabel(label: string, used: Set<string>): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32)
    .replace(/-+$/gu, "");
  const base = OPTION_ID.test(slug) ? slug : "option";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    const suffix = `-${n}`;
    id = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(id);
  return id;
}

export function optionsFromLabels(labels: readonly string[]): { id: string; label: string }[] {
  const used = new Set<string>();
  return labels.map((label) => ({ id: optionIdFromLabel(label, used), label: label.trim() }));
}
