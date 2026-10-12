import { prisma } from "@/lib/db/prisma";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { isPartnerCode } from "@/lib/partners/referral/is-partner-code";

/**
 * The ONE seam between the consumer referral programme and the partner programme. Everything else in the referral code is
 * independent of the partner code (independence.test.ts allows this file, and only this file, to import from it).
 *
 * `partnerCodeExists` answers "is this a partner's code?" from the partner table (any case, any partner status). It is
 * given the code as the app sent it (trimmed, not normalised: the two programmes spell codes differently).
 * `partnerProgrammeLive` says whether the partner side actually credits first touches right now (its flag), so a partner
 * credit is only claimed, and a signup only flagged for it, when one was really written.
 */
export type PartnerProbe = (code: string) => Promise<boolean>;

export const partnerCodeExists: PartnerProbe = (code) => isPartnerCode(prisma as never, code);

export const partnerProgrammeLive = (env: Record<string, string | undefined> = process.env): boolean => isPartnerWorkspaceEnabled(env);
