import { NATIVE_FUNNEL_FILTERS, parseSegment, type Segment } from "./attribution";

/** Reads the filters of the native Partner pages from the URL. Only known values get through, so nothing arbitrary reaches a query. */
export const PARTNER_STATUSES = ["ONBOARDING", "ACTIVE", "SUSPENDED", "TERMINATED"] as const;
export const PARTNER_TIERS = ["PLATINUM", "GOLD", "SILVER", "BRONZE"] as const;
export const PAYOUT_STATUSES = ["ESTIMATED", "APPROVED", "RECONCILED_EXTERNALLY"] as const;
export const VIEWS = ["accruals", "adjustments", "runs", "payouts"] as const;
export const ACCRUAL_STATUSES = ["ACCRUED", "ADJUSTED", "REVERSED", "INCLUDED_IN_PAYOUT"] as const;
const KNOWN_STATUS: readonly string[] = [...PARTNER_STATUSES, ...PAYOUT_STATUSES];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type NativeQuery = {
  q: string | undefined;
  offset: number;
  status: string | undefined;
  tier: string | undefined;
  segment: Segment;
  funnel: string | undefined;
  partner: string | undefined;
  run: string | undefined;
  accrual: string | undefined;
  view: string | undefined;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const oneOf = (v: string | undefined, list: readonly string[]) => (v !== undefined && list.includes(v) ? v : undefined);

export function parseNativeQuery(sp: Record<string, string | string[] | undefined>): NativeQuery {
  const offset = Number.parseInt(first(sp.offset) ?? "0", 10);
  const funnel = first(sp.funnel);
  return {
    q: first(sp.q)?.trim().slice(0, 80) || undefined,
    offset: Number.isFinite(offset) && offset > 0 ? Math.min(offset, 100000) : 0,
    status: oneOf(first(sp.status), KNOWN_STATUS),
    tier: oneOf(first(sp.tier), PARTNER_TIERS),
    segment: parseSegment(first(sp.segment)),
    funnel: funnel !== "all" ? oneOf(funnel, NATIVE_FUNNEL_FILTERS) : undefined,
    partner: ID.test(first(sp.partner) ?? "") ? first(sp.partner) : undefined,
    run: ID.test(first(sp.run) ?? "") ? first(sp.run) : undefined,
    accrual: oneOf(first(sp.accrual), ACCRUAL_STATUSES),
    view: oneOf(first(sp.view), VIEWS),
  };
}

/** The status the partner list may filter on: only an empanelment status counts there. */
export const partnerStatusOf = (q: NativeQuery) => oneOf(q.status, PARTNER_STATUSES);
/** The status the payout list may filter on: only a payout status counts there. */
export const payoutStatusOf = (q: NativeQuery) => oneOf(q.status, PAYOUT_STATUSES);

type Param = string | number | undefined;

/** A page URL from its non-empty parameters, in a stable order. Empty values, a zero offset and the default segment are left out. */
export function nativeHref(path: string, params: Record<string, Param>): string {
  const sp = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (v === undefined || v === "" || (key === "offset" && Number(v) === 0) || (key === "segment" && v === "all")) continue;
    sp.set(key, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}
