// Computes ShadowStats (exit-criteria.ts) from the database, plus the gate-run record. The report command and the admin page both call this.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { basePrisma } from "@/lib/db/prisma";
import { CONSENT_POLICY, resolvePolicy } from "@/lib/consent/policy";
import { DAY_MS } from "./constants";
import { oracleAllows, type OraclePolicy, type OracleRow } from "./consent-oracle";
import { evaluateExitCriteria, type ExitReport, type ShadowStats } from "./exit-criteria";
import { outcomeRates } from "./outcome-linking";
import { purposeFor } from "./policy";

export const DEFAULT_WINDOW_DAYS = 14;
const SERIOUS_WRONG = new Set(["wrong_fact", "wrong_customer", "wrong_product"]);
const CONTACT_CHANNELS = ["call", "whatsapp", "email"];

export type GateRecord = { recordedAt: string; tests: "pass" | "fail" | "unknown"; evals: "pass" | "fail" | "unknown" };
const gateFile = () => process.env.DECISION_GATES_FILE ?? path.join(process.cwd(), ".decision-gates.json");

export function readGateRecord(): GateRecord | null {
  try {
    const f = gateFile();
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as GateRecord) : null;
  } catch {
    return null;
  }
}
export function writeGateRecord(r: GateRecord): void {
  writeFileSync(gateFile(), JSON.stringify(r, null, 2) + "\n");
}

export type ShadowReport = { windowDays: number; since: string; stats: ShadowStats; exit: ExitReport; gateRecordedAt: string | null; consentMismatches: { decisionId: string; clientId: string; channel: string }[]; rates: ReturnType<typeof outcomeRates>; byResult: Record<string, number>; abstainReasons: Record<string, number>; feedbackKinds: Record<string, number> };

export async function computeShadowReport(now = new Date(), windowDays = DEFAULT_WINDOW_DAYS): Promise<ShadowReport> {
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const where = { mode: "SHADOW", createdAt: { gte: since } };
  const [decisions, material, daily, dis, feedback, outcomes] = await Promise.all([
    basePrisma.decisionRecord.findMany({ where, select: { id: true, clientId: true, createdAt: true, result: true, abstainReason: true, channel: true, assetClass: true, programme: true, policyResult: true }, orderBy: { createdAt: "asc" }, take: 20000 }),
    basePrisma.decisionDisagreement.count({ where: { severity: "material", decision: where } }),
    basePrisma.$queryRaw<{ d: string; decisions: bigint; disagreements: bigint }[]>`
      SELECT to_char(date_trunc('day', r."createdAt"), 'YYYY-MM-DD') AS d, count(*) AS decisions, count(x."id") AS disagreements
      FROM "DecisionRecord" r LEFT JOIN "DecisionDisagreement" x ON x."decisionId" = r."id"
      WHERE r."mode" = 'SHADOW' AND r."createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    basePrisma.decisionDisagreement.count({ where: { decision: where } }),
    basePrisma.decisionFeedback.findMany({ where: { decision: where, userId: { not: "system" } }, select: { decisionId: true, kind: true, reason: true } }),
    basePrisma.decisionOutcome.findMany({ where: { decision: where }, select: { decisionId: true, kind: true } }),
  ]);
  void dis;

  // Consent agreement: every recommended contact channel, re-checked by the independent oracle as of the decision time.
  const contact = decisions.filter((d) => d.result === "RECOMMEND" && CONTACT_CHANNELS.includes(d.channel));
  const clientIds = [...new Set(contact.map((d) => d.clientId))];
  const [rows, clients] = clientIds.length
    ? await Promise.all([
        basePrisma.consentRecord.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, purpose: true, channel: true, status: true, capturedAt: true, expiresAt: true } }),
        basePrisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, marketingConsentAt: true } }),
      ])
    : [[], []];
  const byClient = new Map<string, OracleRow[]>();
  for (const r of rows) (byClient.get(r.clientId) ?? byClient.set(r.clientId, []).get(r.clientId)!).push(r);
  const legacy = new Map(clients.map((c) => [c.id, c.marketingConsentAt]));
  const policy = resolvePolicy(process.env, CONSENT_POLICY);
  const oraclePolicy: OraclePolicy = Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, v.mode]));
  const mismatches: ShadowReport["consentMismatches"] = [];
  for (const d of contact) {
    const purpose = (d.policyResult as { consentPurpose?: string | null } | null)?.consentPurpose ?? purposeFor({ sales: d.assetClass !== null });
    if (!oracleAllows(byClient.get(d.clientId) ?? [], legacy.get(d.clientId) ?? null, purpose, d.channel, d.createdAt, oraclePolicy)) mismatches.push({ decisionId: d.id, clientId: d.clientId, channel: d.channel });
  }

  // Sampled product review: product recommendations a reviewer reacted to.
  const productIds = new Set(decisions.filter((d) => d.result === "RECOMMEND" && d.assetClass !== null).map((d) => d.id));
  const reviewed = new Set<string>();
  const serious = new Set<string>();
  for (const f of feedback) {
    if (!productIds.has(f.decisionId)) continue;
    reviewed.add(f.decisionId);
    if ((f.kind === "wrong" && SERIOUS_WRONG.has(f.reason ?? "")) || (f.kind === "dnr" && f.reason === "customer_asked")) serious.add(f.decisionId);
  }

  const gate = readGateRecord();
  const stats: ShadowStats = {
    decisions: decisions.length,
    materialRegressions: material,
    daily: daily.map((r) => ({ date: r.d, decisions: Number(r.decisions), disagreements: Number(r.disagreements) })),
    consent: { checked: contact.length, mismatches: mismatches.length },
    productReview: { reviewedProductDecisions: reviewed.size, seriousFalsePositives: serious.size },
    gates: { tests: gate?.tests ?? "unknown", evals: gate?.evals ?? "unknown" },
  };

  const kindsBy = new Map<string, string[]>();
  for (const o of outcomes) (kindsBy.get(o.decisionId) ?? kindsBy.set(o.decisionId, []).get(o.decisionId)!).push(o.kind);
  const fbBy = new Map<string, string>();
  for (const f of feedback) fbBy.set(f.decisionId, f.kind);
  const rates = outcomeRates(decisions.filter((d) => d.result === "RECOMMEND").map((d) => ({ decisionId: d.id, feedback: fbBy.get(d.id) ?? null, outcomeKinds: (kindsBy.get(d.id) ?? []) as never })));

  const byResult: Record<string, number> = {};
  const abstainReasons: Record<string, number> = {};
  for (const d of decisions) {
    byResult[d.result] = (byResult[d.result] ?? 0) + 1;
    if (d.abstainReason) abstainReasons[d.abstainReason] = (abstainReasons[d.abstainReason] ?? 0) + 1;
  }
  const feedbackKinds: Record<string, number> = {};
  for (const f of feedback) feedbackKinds[f.kind] = (feedbackKinds[f.kind] ?? 0) + 1;

  return { windowDays, since: since.toISOString(), stats, exit: evaluateExitCriteria(stats), gateRecordedAt: gate?.recordedAt ?? null, consentMismatches: mismatches.slice(0, 50), rates, byResult, abstainReasons, feedbackKinds };
}
