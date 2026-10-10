/**
 * Who counts as referred by a partner, and how a referred person is shown. Pure helpers; the query itself is in queries.ts.
 *
 * Attribution has two sources in the CRM, in this order of authority:
 *  1. ACCOUNT: a trading account whose `sourcingPartnerId` is the partner. This is the link the commission engine pays on.
 *  2. LEAD: a customer record with no sourced account yet, whose lead attribution (`leadAttribution.partnerCode`) or
 *     free-text `referralSource` equals the partner's code. Nothing is paid on a lead until an account is sourced.
 * A person with a sourced account is shown once, under that account's partner.
 */
export type Segment = "all" | "clients" | "leads";
export const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "all", label: "All" },
  { key: "clients", label: "Clients" },
  { key: "leads", label: "Leads" },
];
export const parseSegment = (v: string | undefined): Segment => (SEGMENTS.some((s) => s.key === v) ? (v as Segment) : "all");

/** "Priya Sharma" -> "Priya S.": enough to tell people apart on a list, not enough to identify them. */
export function maskName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Unnamed";
  const [first, ...rest] = parts;
  return [first, ...rest.map((p) => `${p.charAt(0).toUpperCase()}.`)].join(" ");
}

export type FunnelInput = { via: "ACCOUNT" | "LEAD"; anyActive: boolean; accounts: number; latestStatus: string | null };

/** The stage shown for a referred person. Account statuses are the CRM's own (ACTIVE, DORMANT, CLOSED, SUSPENDED). */
export function funnelOf(i: FunnelInput): string {
  if (i.via === "LEAD" || i.accounts === 0) return "LEAD";
  if (i.anyActive) return "ACTIVE";
  return i.latestStatus ?? "ACCOUNT_OPENED";
}

export const NATIVE_FUNNEL_FILTERS = ["all", "LEAD", "ACTIVE", "DORMANT", "CLOSED", "SUSPENDED"];

/** Escapes LIKE wildcards in user text (use with ESCAPE '\'). */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
