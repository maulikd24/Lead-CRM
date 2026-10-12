import { parseTabParam } from "./tab-logic";

/**
 * Lazy tabs: a page builds only the section for the tab in the URL, so the queries behind the other tabs never run. The tab comes
 * from `?tab=` on the server, so a deep link still opens the right section, and an unknown value falls back to the default.
 * Each builder is a thunk: a section that is not requested is never even created.
 */
export function lazyPanels<T>(
  keys: readonly string[],
  requested: string | string[] | null | undefined,
  fallback: string,
  builders: Record<string, () => T>,
): Record<string, T | null> {
  const active = parseTabParam(requested, keys, fallback);
  const out: Record<string, T | null> = {};
  for (const key of keys) out[key] = key === active && builders[key] ? builders[key]() : null;
  return out;
}

/** In a lazy workspace, a tab whose section was not sent with the page needs a server navigation (which keeps the URL, history and deep link in step). */
export function needsServerTrip(lazy: boolean, panels: Record<string, unknown>, key: string): boolean {
  return lazy && panels[key] == null;
}
