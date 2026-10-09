import { z } from "zod";

/**
 * Response contracts the Partner workspace reads from the referral API. Field names follow the
 * generic contract in docs/partner-workspace.md. Parsing is strict on the few fields a row cannot
 * be shown without (id, status) and tolerant everywhere else: optional fields default, unknown extra
 * fields are dropped, and unknown enum values pass through as plain strings so a new status on the
 * server never breaks a page.
 *
 * Sensitive fields (PAN, bank details) are deliberately NOT declared: zod drops undeclared keys, so
 * they can never reach a page even if the server sends them.
 */

const id = z.union([z.string().min(1), z.number()]).transform(String);
const money = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)])
  .transform(Number)
  .pipe(z.number().finite());
const moneyOr0 = money.optional().default(0);
const count = z.number().int().nonnegative().optional().default(0);
const text = z.string().nullish().transform((v) => v ?? null);
const when = z.string().nullish().transform((v) => v ?? null);

export const envelopeSchema = z.object({
  code: z.number().optional(),
  msg: z.string().nullish(),
  data: z.unknown(),
  error: z.unknown().optional(),
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
  earningsTotal: moneyOr0,
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
    .object({ available: moneyOr0, onHold: moneyOr0 })
    .optional()
    .default({ available: 0, onHold: 0 }),
  payouts: z
    .object({ requested: count, paid: count, paidTotal: moneyOr0, lastPaidAt: when })
    .optional()
    .default({ requested: 0, paid: 0, paidTotal: 0, lastPaidAt: null }),
  activity: z.array(activitySchema).optional().default([]),
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
  amount: moneyOr0,
  tdsAmount: money.nullish().transform((v) => v ?? null),
  netAmount: money.nullish().transform((v) => v ?? null),
  requestedAt: when,
  decidedAt: when,
  paidAt: when,
});
export type Withdrawal = z.infer<typeof withdrawalSchema>;

function pageOf<T extends z.ZodType>(item: T) {
  return z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    })
    .transform((p) => ({
      items: p.items,
      total: p.total ?? p.items.length,
      limit: p.limit ?? p.items.length,
      offset: p.offset ?? 0,
    }));
}

export const referrerPageSchema = pageOf(referrerSchema);
export const refereePageSchema = pageOf(refereeSchema);
export const withdrawalPageSchema = z
  .object({
    items: z.array(withdrawalSchema),
    total: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    summary: z
      .object({
        byStatus: z.record(z.string(), z.object({ count, amount: moneyOr0 })).optional().default({}),
      })
      .optional(),
  })
  .transform((p) => ({
    items: p.items,
    total: p.total ?? p.items.length,
    limit: p.limit ?? p.items.length,
    offset: p.offset ?? 0,
    summary: p.summary,
  }));

export const summarySchema = z.object({
  referrers: z
    .object({ total: count, active: count, pending: count, suspended: count, terminated: count })
    .optional()
    .default({ total: 0, active: 0, pending: 0, suspended: 0, terminated: 0 }),
  referees: z.object({ total: count, active: count }).optional().default({ total: 0, active: 0 }),
  earnings: z
    .object({ lastMonth: moneyOr0, lastMonthLabel: text, total: moneyOr0 })
    .optional()
    .default({ lastMonth: 0, lastMonthLabel: null, total: 0 }),
  monthly: z
    .array(z.object({ period: z.string(), earnings: moneyOr0, referees: count }))
    .optional()
    .default([]),
  topReferrers: z
    .array(z.object({ id, fullName: z.string(), referralCode: text, refereeCount: count, earningsTotal: moneyOr0 }))
    .optional()
    .default([]),
});
export type Summary = z.infer<typeof summarySchema>;

export type Page<T> = { items: T[]; total: number; limit: number; offset: number };
export type WithdrawalPage = z.infer<typeof withdrawalPageSchema>;
