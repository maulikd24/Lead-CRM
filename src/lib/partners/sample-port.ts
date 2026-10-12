import type { Page, Referee, Referrer, ReferrerDetail, Summary, WithdrawalPage } from "./schemas";

/**
 * The read interface behind the made-up development data (`PARTNER_SOURCE=sample`). Reads only; no write method exists.
 * The native source has its own, richer port (native/queries.ts).
 */
export type PartnerReadErrorKind = "not_configured" | "not_found" | "server";

const MESSAGES: Record<PartnerReadErrorKind, string> = {
  not_configured: "Sample data is not available here.",
  not_found: "That record was not found.",
  server: "The partner data could not be read.",
};

export class PartnerReadError extends Error {
  constructor(public readonly kind: PartnerReadErrorKind) {
    super(MESSAGES[kind]);
    this.name = "PartnerReadError";
  }
}

export const DEFAULT_PAGE_SIZE = 25;

export type ListParams = { limit?: number; offset?: number; search?: string; sort?: string };
export type ReferrerFilters = ListParams & { status?: string; kycStatus?: string };
export type RefereeFilters = ListParams & { referrerId?: string; funnelStatus?: string };
export type WithdrawalFilters = ListParams & { status?: string; referrerId?: string };

export interface SamplePartnerPort {
  getSummary(): Promise<Summary>;
  listReferrers(f: ReferrerFilters): Promise<Page<Referrer>>;
  getReferrer(id: string): Promise<ReferrerDetail>;
  listReferees(f: RefereeFilters): Promise<Page<Referee>>;
  listWithdrawals(f: WithdrawalFilters): Promise<WithdrawalPage>;
}
