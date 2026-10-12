/** Pure helpers behind WorkspaceTabs: keyboard model, ids and the ?tab= URL contract. No React, no DOM. */

export const TAB_PARAM = "tab";

export const tabDomId = (prefix: string, key: string) => `${prefix}-tab-${key}`;
export const panelDomId = (prefix: string, key: string) => `${prefix}-panel-${key}`;

/**
 * WAI-ARIA tabs (horizontal): Left/Right move to the neighbour and wrap, Home/End jump to the ends. Returns null for any
 * other key. An unknown `current` behaves like "before the first tab".
 */
export function nextTabKey(keys: readonly string[], current: string, key: string): string | null {
  if (keys.length === 0) return null;
  const i = keys.indexOf(current);
  if (key === "ArrowRight") return keys[(i + 1) % keys.length];
  if (key === "ArrowLeft") return keys[i <= 0 ? keys.length - 1 : i - 1];
  if (key === "Home") return keys[0];
  if (key === "End") return keys[keys.length - 1];
  return null;
}

type KeyEventLike = { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; preventDefault: () => void };

/** onKeyDown for the tablist. `focusAndActivate` focuses the target tab and activates it (arrow keys select as they move). */
export function createTabKeyHandler(opts: { keys: readonly string[]; active: string; focusAndActivate: (key: string) => void }) {
  return (e: KeyEventLike) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const target = nextTabKey(opts.keys, opts.active, e.key);
    if (target === null) return;
    e.preventDefault();
    opts.focusAndActivate(target);
  };
}

/** Reads the tab from a query value; anything that is not a known tab falls back (so a hand-edited URL never breaks the page). */
export function parseTabParam(value: string | string[] | null | undefined, keys: readonly string[], fallback: string): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v != null && keys.includes(v) ? v : fallback;
}

/** `search` with the tab set. The default tab drops the parameter, so there is one canonical URL per tab. Returns "" or "?...". */
export function withTab(search: string, key: string, opts: { fallback: string; param?: string }): string {
  const param = opts.param ?? TAB_PARAM;
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (key === opts.fallback) q.delete(param);
  else q.set(param, key);
  const out = q.toString();
  return out ? `?${out}` : "";
}

export function tabHref(pathname: string, search: string, key: string, opts: { fallback: string; param?: string }): string {
  return `${pathname}${withTab(search, key, opts)}`;
}
