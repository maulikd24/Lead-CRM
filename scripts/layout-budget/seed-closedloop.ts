/**
 * Synthetic closed-loop data for the layout-budget and axe runs: the demo destination switched on, 36 synthetic customers with outbox rows in every state (sent, waiting,
 * retrying, failed for good, and skipped for each reason), and one pending destination change and one pending wording change so the approvals show. Local database only.
 * Nothing here is a real person and nothing is sent anywhere (the demo destination has no network). Idempotent.
 *
 *   npm run layout-budget:seed          (needs the standard seed first)
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { prisma } from "../../src/lib/db/prisma";

const DAY = 86_400_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);

const STATES: { status: string; reason: string | null; n: number }[] = [
  { status: "SENT", reason: null, n: 12 },
  { status: "PENDING", reason: null, n: 4 },
  { status: "FAILED", reason: "http_500", n: 3 },
  { status: "DEAD", reason: "invalid_params", n: 2 },
  { status: "SKIPPED", reason: "CONSENT_MISSING", n: 5 },
  { status: "SKIPPED", reason: "CONSENT_WITHDRAWN", n: 3 },
  { status: "SKIPPED", reason: "NO_IDENTIFIERS", n: 4 },
  { status: "SKIPPED", reason: "TOO_OLD", n: 3 },
];

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } });
  const stage = (await prisma.stage.findFirst({ orderBy: { sequence: "asc" } }))!;
  if (await prisma.client.findUnique({ where: { clientCode: "LB-CL-01" } })) {
    console.log("layout-budget closed-loop seed already present");
    return;
  }
  await prisma.integrationConfig.upsert({
    where: { provider: "closedloop_fake" },
    update: { settings: { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false }, isEnabled: true, mode: "mock" },
    create: { provider: "closedloop_fake", mode: "mock", settings: { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false }, isEnabled: true },
  });
  let i = 0;
  for (const s of STATES) {
    for (let k = 0; k < s.n; k++) {
      i++;
      const code = `LB-CL-${String(i).padStart(2, "0")}`;
      const client = await prisma.client.create({ data: { clientCode: code, name: `Closed loop sample ${i}`, mobile: `97000000${String(10 + i)}`, currentStageId: stage.id, assignedToId: admin.id, createdAt: ago((i + 3) * DAY) } });
      await prisma.consentRecord.create({ data: { clientId: client.id, purpose: "ADS_MEASUREMENT", status: s.reason === "CONSENT_MISSING" ? "WITHDRAWN" : "GRANTED", source: "RM_RECORDED", reason: "layout-budget seed", capturedAt: ago((i + 10) * DAY) } });
      const at = ago((i % 5 + 1) * DAY);
      await prisma.conversionOutbox.create({
        data: {
          clientId: client.id, destination: "fake", eventType: i % 2 ? "FIRST_FUNDING" : "KYC_COMPLETE", dedupId: `cl1_lb_${i}`, occurredAt: at, status: s.status, reason: s.reason, attempts: s.status === "PENDING" || s.status === "SKIPPED" ? 0 : s.status === "SENT" ? 1 : 3,
          nextAttemptAt: s.status === "FAILED" ? new Date(now + 600_000) : null, sentAt: s.status === "SENT" ? at : null, matched: s.status === "SENT" ? i % 3 !== 0 : null, identity: s.reason === "NO_IDENTIFIERS" || s.status === "SKIPPED" ? {} : { hashedEmail: "ab".repeat(32) },
        },
      });
    }
  }
  await prisma.approvalRequest.create({ data: { actionType: "CLOSED_LOOP_DESTINATION", entity: "ClosedLoopDestination", entityId: "meta_capi", payload: { destination: "meta_capi", enabled: true, region: "in", allowedRegions: ["in"], sendValue: false }, requestedById: admin.id } });
  await prisma.approvalRequest.create({ data: { actionType: "CONSENT_POLICY_CHANGE", entity: "ClosedLoopConsentNotice", entityId: "ADS_MEASUREMENT", payload: { purpose: "ADS_MEASUREMENT", text: "We may tell advertising platforms, using coded identifiers only, that you completed KYC or funded, so they can measure which ads work.", version: "2027-04" }, requestedById: admin.id } });
  console.log("seeded closed-loop data");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
