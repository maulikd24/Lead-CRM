import { z } from "zod";

/**
 * Response contracts the Partner workspace reads from the referral API. THE FIELD NAMES ARE PROPOSED AND
 * UNVERIFIED against any running service (see docs/partner-workspace.md and scripts/partner-contract-check.ts).
 *
 * Rules:
 * - ANCHOR fields (the ones every number on screen depends on) are required. A response that lacks one, or uses
 *   another name for it, is rejected as an unexpected shape. Nothing is ever defaulted to 0.
 * - Genuinely optional values are nullable and shown as a dash.
 * - Unknown extra keys are ignored; unknown status strings pass through and are shown as "Unknown".
 * - Sensitive fields (PAN, bank details) are deliberately NOT declared: undeclared keys are dropped.
 */

const id = z.union([z.string().min(1), z.number()]).transform(String);
const money = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)])
  .transform(Number)
  .pipe(z.number().finite());
const moneyOrNull = money.nullish().transform((v) => v ?? null);
const count = z.number().int().nonnegative();
const countOrNull = count.nullish().transform((v) => v ?? null);
const text = z.string().nullish().transform((v) => v ?? null);
const when = z.string().nullish().transform((v) => v ?? null);

export const envelopeSchema = z.object({
  code: z.number().optional(),
  data: z.unknown(),
});

export const referrerSchema = z.object({
  id,
  fullName: z.string().min(1),
  referrerType: text,
  status: z.string().min(1),
  kycStatus: text,
  referralCode: text,
  mobile: text,
  clientCode: text,
  refereeCount: count,
  earningsTotal: money,
  enrolledAt: when,
  activatedAt: when,
});
export type Referrer = z.infer<typeof referrerSchema>;

export const activitySchema = z.object({ at: z.string(), action: z.string(), label: text });

export const referrerDetailSchema = referrerSchema.extend({
  suspensionReason: text,
  withdrawalHold: text,
  agreementGraceUntil: when,
  wallet: z
    .object({ available: moneyOrNull, onHold: moneyOrNull })
    .nullish()
    .transform((v) => v ?? null),
  payouts: z
    .object({ requested: countOrNull, paid: countOrNull, paidTotal: moneyOrNull, lastPaidAt: when })
    .nullish()
    .transform((v) => v ?? null),
  activity: z.array(activitySchema).nullish().transform((v) => v ?? []),
});
export type ReferrerDetail = z.infer<typeof referrerDetailSchema>;

export const refereeSchema = z.object({
  id,
  displayName: text,
  referrerId: id.nullish().transform((v) => v ?? null),
  referrerName: text,
  attributionStatus: text,
  funnelStatus: z.string().min(1),
  signupChannel: text,
  kycStatus: text,
  clientCode: text,
  signedUpAt: when,
  accountOpenedAt: when,
  lastBrokerageDate: when,
});
export type Referee = z.infer<typeof refereeSchema>;

export const withdrawalSchema = z.object({
  id,
  withdrawalRef: text,
  referrerId: id.nullish().transform((v) => v ?? null),
  referrerName: text,
  requestType: text,
  status: z.string().min(1),
  amount: money,
  tdsAmount: moneyOrNull,
  netAmount: moneyOrNull,
  requestedAt: when,
  decidedAt: when,
  paidAt: when,
});
export type Withdrawal = z.infer<typeof withdrawalSchema>;

const pageShape = {
  total: z.number().int().nonnegative().nullish().transform((v) => v ?? null),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
};

function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), ...pageShape }).transform((p) => ({
    items: p.items,
    /** null = the service did not say how many exist. Never guessed from the page. */
    total: p.total,
    limit: p.limit ?? p.items.length,
    offset: p.offset ?? 0,
  }));
}

export const referrerPageSchema = pageOf(referrerSchema);
export const refereePageSchema = pageOf(refereeSchema);
export const withdrawalPageSchema = z
  .object({
    items: z.array(withdrawalSchema),
    ...pageShape,
    summary: z
      .object({ byStatus: z.record(z.string(), z.object({ count, amount: money })) })
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .transform((p) => ({ items: p.items, total: p.total, limit: p.limit ?? p.items.length, offset: p.offset ?? 0, summary: p.summary }));

export const summarySchema = z.object({
  referrers: z.object({ total: count, active: countOrNull, pending: countOrNull, suspended: countOrNull, terminated: countOrNull }),
  referees: z.object({ total: count, active: countOrNull }),
  earnings: z.object({ lastMonth: money, lastMonthLabel: text, total: moneyOrNull }),
  monthly: z.array(z.object({ period: z.string(), earnings: money, referees: countOrNull })),
  topReferrers: z.array(z.object({ id, fullName: z.string(), referralCode: text, refereeCount: count, earningsTotal: money })),
});
export type Summary = z.infer<typeof summarySchema>;

export type Page<T> = { items: T[]; total: number | null; limit: number; offset: number };
export type WithdrawalPage = z.infer<typeof withdrawalPageSchema>;
