import { redactFeedback } from "./redact";
import type { VocTheme } from "./themes";

/** One item after tagging. `text` is the redacted text, so examples taken from it carry no identifiers. */
export type TaggedItem =
  | { id: string; text: string; kind: "tagged"; themes: VocTheme[] }
  | { id: string; text: string; kind: "abstain"; reason: string };

export type ThemeCount = { theme: VocTheme; count: number; share: number; examples: string[] };

export type ThemeSummary = {
  /** Who the summary is for. A management read; it is never a message to a customer. */
  audience: "management";
  totalItems: number;
  taggedItems: number;
  abstainedItems: number;
  themes: ThemeCount[];
};

export const EXAMPLES_PER_THEME = 3;
export const MAX_EXAMPLE_CHARS = 160;

/**
 * Counts how many tagged items carry each theme (an item counts once per theme), and keeps the first few redacted examples.
 * Abstained items are counted apart and never add to a theme. Sorted by count, then by theme name, so the output is stable.
 */
export function aggregateThemes(items: readonly TaggedItem[]): ThemeSummary {
  const byTheme = new Map<VocTheme, { count: number; examples: string[] }>();
  let taggedItems = 0;
  let abstainedItems = 0;
  for (const item of items) {
    if (item.kind === "abstain") {
      abstainedItems += 1;
      continue;
    }
    taggedItems += 1;
    for (const theme of new Set(item.themes)) {
      const slot = byTheme.get(theme) ?? { count: 0, examples: [] };
      slot.count += 1;
      if (slot.examples.length < EXAMPLES_PER_THEME) slot.examples.push(safeExample(item.text));
      byTheme.set(theme, slot);
    }
  }
  const themes: ThemeCount[] = [...byTheme.entries()]
    .map(([theme, s]) => ({ theme, count: s.count, share: taggedItems === 0 ? 0 : Math.round((s.count / taggedItems) * 1000) / 1000, examples: s.examples }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
  return { audience: "management", totalItems: items.length, taggedItems, abstainedItems, themes };
}

/** Redacts again and cuts the example, so an example never carries an identifier even if the caller passed raw text. */
export function safeExample(text: string): string {
  const { text: masked } = redactFeedback(text.replace(/\s+/g, " ").trim());
  return masked.length > MAX_EXAMPLE_CHARS ? `${masked.slice(0, MAX_EXAMPLE_CHARS - 1)}…` : masked;
}
