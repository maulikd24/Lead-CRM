import { isLedgerKind, type LedgerKind } from "./types";

/** Query-string parsing for the read API and the investigate page. Strict: anything odd is dropped, never passed on. */
const ID = /^[A-Za-z0-9_:.\-]{1,200}$/;

export const cleanId = (v: string | null | undefined): string | null => (v && ID.test(v.trim()) ? v.trim() : null);
export const parseKinds = (v: string | null | undefined): LedgerKind[] => (v ? [...new Set(v.split(",").map((x) => x.trim()).filter(isLedgerKind))] : []);
export const parseLimit = (v: string | null | undefined): number | undefined => {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : undefined;
};
export const parseBefore = (v: string | null | undefined): string | null => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export const INVESTIGATE_BY = ["correlation", "customer", "run", "approval"] as const;
export type InvestigateBy = (typeof INVESTIGATE_BY)[number];
export const parseBy = (v: string | null | undefined): InvestigateBy => ((INVESTIGATE_BY as readonly string[]).includes(v ?? "") ? (v as InvestigateBy) : "correlation");
