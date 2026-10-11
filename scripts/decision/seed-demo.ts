/**
 * npm run decision:seed -- [--per 3]
 * Synthetic customers for the Decision Engine: one family per situation the rules care about (complaint, decline, do-not-contact, withdrawn
 * WhatsApp consent, AI-only interest, conflicting evidence, compliance concern, recent contact, ...), with event history spread over the
 * last 45 days so the replay has something to chew on. Local database only. Nothing here is a real person. Idempotent by client code.
 * Needs the standard seed first (users and stages).
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";
import { prisma } from "../../src/lib/db/prisma";

const DAY = 86_400_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const per = (() => { const i = process.argv.indexOf("--per"); return i >= 0 ? Number(process.argv[i + 1]) : 3; })();

type Arch = { key: string; stage: string; make: (id: string, n: number) => Promise<void>; client?: Record<string, unknown> };

async function main() {
  const rms = await prisma.user.findMany({ where: { role: "RM" }, orderBy: { email: "asc" } });
  if (rms.length === 0) throw new Error("Run `npx tsx prisma/seed.ts` first (needs an RM user).");
  const stages = new Map((await prisma.stage.findMany()).map((s) => [s.name, s.id]));
  const insight = (clientId: string, kind: string, over: Record<string, unknown> = {}) =>
    prisma.conversationInsight.create({ data: { clientId, kind: kind as never, text: `Synthetic ${kind.toLowerCase()} note`, status: "OPEN", sourceType: "NOTE", sourceRef: "seed", dedupeKey: `seed-${clientId}-${kind}-${Math.random()}`, occurredAt: ago(3 * DAY), ...over } });
  const consent = (clientId: string, purpose: string, status: string, over: Record<string, unknown> = {}) => prisma.consentRecord.create({ data: { clientId, purpose, status, source: "RM_RECORDED", capturedAt: ago(30 * DAY), ...over } });
  const activity = (clientId: string, type: string, ms: number) => prisma.activity.create({ data: { clientId, type: type as never, payload: { message: "Synthetic" }, createdAt: ago(ms) } });
  const hni = { customerCategory: "HNI", clientType: "HNI", expectedInvestment: 30_000_000, productInterest: "PMS" };

  const archs: Arch[] = [
    { key: "fresh", stage: "New Lead", make: async () => {} },
    { key: "kycstuck", stage: "Submitted for KYC", client: { stageEnteredAt: ago(6 * DAY) }, make: async (id) => { await prisma.kycRecord.create({ data: { clientId: id, status: "PENDING" } }); await activity(id, "CONTACT", 9 * DAY); } },
    { key: "exception", stage: "Submitted for KYC", make: async (id) => { await prisma.exception.create({ data: { clientId: id, stageId: stages.get("Submitted for KYC")!, reason: "PAN name mismatch" } }); } },
    { key: "complaint", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await insight(id, "COMPLAINT", { severity: "high", occurredAt: ago(2 * DAY), text: "Synthetic complaint about a statement" }); await consent(id, "MARKETING_COMMS", "GRANTED"); await activity(id, "CALL", 20 * DAY); } },
    { key: "declined", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await insight(id, "DECLINED", { assetClass: "PMS", occurredAt: ago(8 * DAY) }); await consent(id, "MARKETING_COMMS", "GRANTED"); await activity(id, "CALL", 12 * DAY); } },
    { key: "dnd", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await consent(id, "MARKETING_COMMS", "GRANTED", { capturedAt: ago(60 * DAY) }); await consent(id, "DO_NOT_CONTACT", "GRANTED", { capturedAt: ago(5 * DAY) }); await insight(id, "INTEREST", { assetClass: "PMS" }); await activity(id, "CALL", 30 * DAY); } },
    { key: "wawithdrawn", stage: "KYC completed", client: { status: "ACTIVE" }, make: async (id) => { await consent(id, "MARKETING_COMMS", "GRANTED", { capturedAt: ago(40 * DAY) }); await consent(id, "MARKETING_COMMS", "WITHDRAWN", { channel: "whatsapp", capturedAt: ago(4 * DAY) }); await activity(id, "CONTACT", 6 * DAY); } },
    { key: "aionly", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await insight(id, "INTEREST", { assetClass: "PMS", occurredAt: ago(2 * DAY) }); await consent(id, "MARKETING_COMMS", "GRANTED"); await activity(id, "CALL", 15 * DAY); } },
    { key: "confirmed", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await insight(id, "INTEREST", { assetClass: "PMS", occurredAt: ago(4 * DAY) }); await prisma.interactionOutcome.create({ data: { clientId: id, outcome: "INTERESTED", channel: "CALL", actorType: "RM", assetClass: "PMS", createdAt: ago(3 * DAY) } }); await consent(id, "MARKETING_COMMS", "GRANTED"); await activity(id, "CALL", 3 * DAY + 1000); } },
    { key: "conflict", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await insight(id, "INTEREST", { assetClass: "PMS", occurredAt: ago(2 * DAY) }); await insight(id, "DECLINED", { assetClass: "PMS", occurredAt: ago(40 * DAY) }); await consent(id, "MARKETING_COMMS", "GRANTED"); await activity(id, "CALL", 15 * DAY); } },
    { key: "compliance", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await insight(id, "COMPLIANCE_CONCERN", { severity: "high", text: "Synthetic compliance concern" }); await consent(id, "MARKETING_COMMS", "GRANTED"); } },
    { key: "recent", stage: "Onboarding Completed", client: { status: "ACTIVE", ...hni }, make: async (id) => { await insight(id, "INTEREST", { assetClass: "PMS" }); await prisma.interactionOutcome.create({ data: { clientId: id, outcome: "INTERESTED", channel: "CALL", actorType: "RM", assetClass: "PMS", createdAt: ago(2 * DAY) } }); await consent(id, "MARKETING_COMMS", "GRANTED"); await activity(id, "CALL", 5 * 3_600_000); } },
    { key: "quiet", stage: "Introduction with Dealer", client: { status: "ACTIVE" }, make: async (id) => { await activity(id, "CALL", 14 * DAY); await consent(id, "SERVICE_COMMS", "GRANTED"); } },
    { key: "snoozed", stage: "Submitted for KYC", client: { stageEnteredAt: ago(5 * DAY) }, make: async (id) => { await prisma.kycRecord.create({ data: { clientId: id, status: "PENDING" } }); await prisma.suggestionDismissal.create({ data: { clientId: id, ruleKey: "stage_gate.follow_up_kyc", fingerprint: "Follow up on KYC", snoozeUntil: new Date(now + 3 * DAY), dismissedAt: ago(DAY) } }); await activity(id, "CONTACT", 4 * DAY); } },
    { key: "settled", stage: "Onboarding Completed", client: { status: "COMPLETED" }, make: async (id) => { await activity(id, "CALL", 2 * DAY); await consent(id, "MARKETING_COMMS", "GRANTED"); } },
  ];

  let made = 0;
  for (const a of archs) {
    for (let n = 1; n <= per; n++) {
      const code = `DEC-${a.key.toUpperCase().slice(0, 6)}-${String(n).padStart(2, "0")}`;
      if (await prisma.client.findUnique({ where: { clientCode: code } })) continue;
      const rm = rms[(made + n) % rms.length];
      const c = await prisma.client.create({
        data: { clientCode: code, name: `Synthetic ${a.key} ${n}`, mobile: `+9190000${String(made).padStart(5, "0")}`, email: `synthetic.${a.key}.${n}@example.test`, city: "Pune", currentStageId: stages.get(a.stage)!, assignedToId: rm.id, status: "ACTIVE", createdAt: ago((50 + n) * DAY), stageEnteredAt: ago(4 * DAY), ...(a.client ?? {}) } as never,
      });
      await a.make(c.id, n);
      made += 1;
    }
  }
  console.log(`Decision demo seed: ${made} synthetic customers (${archs.length} situations x ${per})`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
