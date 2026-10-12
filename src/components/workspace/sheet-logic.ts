/** Pure helpers behind Sheet: the ?sheet= URL contract and the Back-button rule. No React, no DOM. */

export const SHEET_PARAM = "sheet";

/** Marker we put in history.state when WE pushed the entry that opened a sheet (so Back closes it). */
export const SHEET_STATE_KEY = "wsSheet";

export const sheetDomId = (name: string) => `sheet-${name}`;

/** The open sheet from a query value. Anything that is not a plain slug is ignored (a hand-edited URL never breaks the page). */
export function parseSheetParam(value: string | string[] | null | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[a-z0-9][a-z0-9_-]{0,47}$/i.test(v) ? v : null;
}

/** `search` with the sheet set (or removed with null); every other parameter is kept. Returns "" or "?...". */
export function withSheet(search: string, name: string | null): string {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (name) q.set(SHEET_PARAM, name);
  else q.delete(SHEET_PARAM);
  const out = q.toString();
  return out ? `?${out}` : "";
}

export const sheetHref = (pathname: string, search: string, name: string | null) => `${pathname}${withSheet(search, name)}`;

/** True when the history entry we are on was pushed by opening this sheet, so closing should step Back instead of rewriting the URL. */
export function shouldGoBack(state: unknown, name: string): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[SHEET_STATE_KEY] === name;
}
