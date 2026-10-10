import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { decideTouch, normalizeReferralCode } from "./touch";

/**
 * Records a referral code against a person: first touch wins, a lapsed touch is replaced, unknown, malformed and inactive codes
 * are ignored, every decision that matters is written to the append-only trail, and nothing here can fail a lead (the caller
 * catches). Idempotent: a retry of the same submission changes nothing and adds no audit row.
 */
export type RecordDb = Pick<PrismaClient, "partnerProfile" | "partnerReferralTouch" | "partnerAttributionEvent">;
export type RecordResult = { decision: "none" | "ignored_malformed" | "ignored_unknown" | "ignored_inactive" | "recorded" | "replaced_lapsed" | "kept_first_same" | "kept_first_other" };

export async function recordReferralTouch(db: RecordDb, input: { clientId: string; rawCode: unknown; source: "web" | "app"; now?: Date; lapseDays: number }): Promise<RecordResult> {
  const now = input.now ?? new Date();
  const raw = typeof input.rawCode === "string" ? input.rawCode.trim() : input.rawCode;
  if (raw === undefined || raw === null || raw === "") return { decision: "none" };

  const event = (decision: string, code: string | null, partnerProfileId: string | null) =>
    db.partnerAttributionEvent.create({ data: { clientId: input.clientId, partnerProfileId, code, decision, source: input.source } });

  const code = normalizeReferralCode(raw);
  if (!code) {
    await event("ignored_malformed", null, null);
    return { decision: "ignored_malformed" };
  }

  const found = await db.partnerProfile.findFirst({ where: { partnerCode: { equals: code, mode: "insensitive" } }, select: { id: true, empanelmentStatus: true } });
  const partner = found ? { partnerProfileId: found.id, status: found.empanelmentStatus } : null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.partnerReferralTouch.findUnique({ where: { clientId: input.clientId }, select: { partnerProfileId: true, expiresAt: true } });
    const d = decideTouch({ existing, partner, now, lapseDays: input.lapseDays });

    if (d.decision === "ignored_unknown" || d.decision === "ignored_inactive") {
      await event(d.decision, code, partner?.partnerProfileId ?? null);
      return { decision: d.decision };
    }
    if (d.decision === "kept_first_same") return { decision: d.decision }; // a retry: nothing changes, nothing to audit
    if (d.decision === "kept_first_other") {
      await event(d.decision, code, partner?.partnerProfileId ?? null);
      return { decision: d.decision };
    }
    try {
      if (d.decision === "recorded") {
        await db.partnerReferralTouch.create({ data: { clientId: input.clientId, partnerProfileId: partner!.partnerProfileId, code, source: input.source, touchedAt: now, expiresAt: d.expiresAt } });
      } else {
        // Replace only if it is still the lapsed row we looked at: a concurrent writer that got there first wins.
        const res = await db.partnerReferralTouch.updateMany({
          where: { clientId: input.clientId, expiresAt: { lte: now } },
          data: { partnerProfileId: partner!.partnerProfileId, code, source: input.source, touchedAt: now, expiresAt: d.expiresAt },
        });
        if (res.count === 0) continue;
      }
      await event(d.decision, code, partner!.partnerProfileId);
      return { decision: d.decision };
    } catch (e) {
      // A simultaneous first touch for the same person: the other writer won, so decide again against its row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  return { decision: "kept_first_other" };
}
