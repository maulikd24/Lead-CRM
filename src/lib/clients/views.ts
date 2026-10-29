import type { ClientFilterParams } from "@/lib/clients/build-client-where";

/**
 * The /clients workspace: one set of filters shown as a list or as the stage board, at the density the person prefers. Pure, so the
 * page, the toolbar, saved views and the tests all read the same rules.
 */
export const CLIENT_VIEWS = ["list", "board"] as const;
export type ClientView = (typeof CLIENT_VIEWS)[number];

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
/** Density is a personal preference, not part of a view: a cookie the server reads, so the list renders right the first time. */
export const DENSITY_COOKIE = "clients-density";

export const SAVED_VIEW_SCOPE = "clients";
export const SAVED_VIEW_NAME_MAX = 40;
export const SAVED_VIEWS_PER_USER = 20;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseClientView(v: string | string[] | undefined): ClientView {
  return first(v) === "board" ? "board" : "list";
}

export function parseDensity(v: string | undefined): Density {
  return v === "compact" ? "compact" : "comfortable";
}

/** Every key a view may carry: the list filters (build-client-where), the SLA filter, the board's quick filter and the view itself. */
const FILTER_KEYS = [
  "q", "stage", "priority", "status", "rm", "kyc", "funding", "dealer", "clientType", "investmentCategory", "leadSource",
  "createdFrom", "createdTo", "updatedFrom", "updatedTo", "archived", "lifecycle", "customerCategory", "segment", "nba", "acceptance",
  "disengaged",
] as const satisfies readonly (keyof ClientFilterParams)[];
export const VIEW_KEYS = [...FILTER_KEYS, "sla", "filter", "view"] as const;
const VIEW_KEY_SET = new Set<string>(VIEW_KEYS);

/**
 * The canonical query string for a view: known keys only, non-empty, trimmed, sorted, no paging, and "view=list" left out (it is the
 * default). Two views that show the same thing get the same string, and a saved view can never smuggle in a parameter the page does
 * not know.
 */
export function canonicalViewQuery(params: Record<string, string | string[] | undefined> | URLSearchParams): string {
  const entries: [string, string][] = [];
  const source = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params).map(([k, v]) => [k, first(v)] as const);
  for (const [k, raw] of source) {
    const v = typeof raw === "string" ? raw.trim().slice(0, 200) : "";
    if (!v || !VIEW_KEY_SET.has(k)) continue;
    if (k === "view" && v === "list") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

export function clientsHref(query: string): string {
  return query ? `/clients?${query}` : "/clients";
}

/** The same filters in the other view (or with any other key changed); paging always resets. */
export function withParam(params: Record<string, string | string[] | undefined>, key: (typeof VIEW_KEYS)[number], value: string | null): string {
  const next: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) next[k] = first(v);
  if (value) next[key] = value;
  else delete next[key];
  return clientsHref(canonicalViewQuery(next));
}

/** A saved view's name, cleaned; null when it is not usable. */
export function cleanViewName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.replace(/\s+/g, " ").trim().slice(0, SAVED_VIEW_NAME_MAX);
  return n.length >= 2 ? n : null;
}
