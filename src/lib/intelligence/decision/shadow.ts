// Shadow run for one customer: build candidates from every existing implementation, run the pipeline, compare with the current
// engine, store the decision. NOTHING here is shown to an RM and nothing is sent or written outward.
import { createHash, randomUUID } from "node:crypto";
import { basePrisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { IntelligenceResult } from "../refresh";
import { generateCandidates } from "./candidates/adapters";
import { compareToLegacy, type Disagreement } from "./disagreement";
import { decide } from "./engine";
import { loadDecisionInput, type DecisionInput } from "./loader";
import { defaultSeams, type DecisionSeams } from "./seams";
import type { Candidate, DecisionDraft } from "./types";

export type BuiltDecision = { draft: DecisionDraft; disagreement: Disagreement; candidates: Candidate[] };

/** Pure. The whole shadow computation for one customer from plain inputs. */
export function buildDecision(input: DecisionInput): BuiltDecision {
  const candidates = generateCandidates(input.adapter);
  const draft = decide({ ctx: input.gate, candidates, factsMissing: input.factsMissing });
  return { draft, disagreement: compareToLegacy(draft, input.legacy), candidates };
}

/** Stable hash of what a person would read; an unchanged customer does not get a new row on every refresh. */
export function hashDraft(d: DecisionDraft): string {
  const stable = { r: d.result, a: d.abstainReason, act: d.action, p: d.programme, t: d.topic, why: d.reason, o: d.owner, c: d.channel, tm: d.timing, nb: d.notBefore, s: d.priorityScore, sup: d.suppression.map((s) => `${s.candidateId}|${s.rule}|${s.effect}`), alt: d.alternatives.map((a) => a.candidateId), ev: d.evidence.map((e) => e.ref) };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32);
}

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

export type Persisted = { id: string; created: boolean };

export async function persistDecision(clientId: string, built: BuiltDecision, legacy: DecisionInput["legacy"], opts: { correlationId?: string } = {}): Promise<Persisted & { correlationId: string }> {
  const { draft, disagreement } = built;
  const hash = hashDraft(draft);
  const correlationId = opts.correlationId ?? `corr_${randomUUID()}`;
  return basePrisma.$transaction(async (tx) => {
    const latest = await tx.decisionRecord.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { id: true, inputHash: true, status: true, correlationId: true } });
    if (latest && latest.inputHash === hash) return { id: latest.id, created: false, correlationId: latest.correlationId };
    const row = await tx.decisionRecord.create({
      data: {
        clientId,
        engineVersion: draft.engineVersion,
        correlationId,
        causationId: latest?.id ?? null,
        result: draft.result,
        abstainReason: draft.abstainReason,
        escalation: draft.escalation,
        action: draft.action,
        programme: draft.programme,
        topic: draft.topic,
        assetClass: draft.assetClass,
        reason: draft.reason,
        priority: draft.priority,
        priorityScore: draft.priorityScore,
        owner: draft.owner,
        channel: draft.channel,
        timing: draft.timing,
        notBefore: draft.notBefore ? new Date(draft.notBefore) : null,
        confidence: draft.confidence,
        evidence: json(draft.evidence),
        scoreInputs: json(draft.scoreInputs),
        suppression: json(draft.suppression),
        policyResult: json(draft.policyResult),
        alternatives: json(draft.alternatives),
        legacy: legacy ? json(legacy) : undefined,
        chosenCandidateId: draft.chosenCandidateId,
        candidateCount: draft.candidateCount,
        inputHash: hash,
        observedAt: new Date(draft.observedAt),
      },
      select: { id: true },
    });
    if (!disagreement.agrees && disagreement.severity !== "none") {
      await tx.decisionDisagreement.create({ data: { decisionId: row.id, kind: disagreement.kind, severity: disagreement.severity, summary: disagreement.summary.slice(0, 500) } });
    }
    // The previous open decision was replaced without anyone acting on it: it expired.
    if (latest && latest.status === "OPEN") {
      await tx.decisionRecord.update({ where: { id: latest.id }, data: { status: "EXPIRED", statusUpdatedAt: new Date() } });
      const reacted = await tx.decisionFeedback.count({ where: { decisionId: latest.id } });
      if (reacted === 0) await tx.decisionFeedback.create({ data: { decisionId: latest.id, userId: "system", kind: "expired" } });
    }
    return { id: row.id, created: true, correlationId };
  });
}

/** One customer, end to end. Callers decide whether the engine is on (see enabled.ts). Never throws into the cron: errors are logged and swallowed by the caller. */
export async function runShadowDecision(clientId: string, opts: { result?: IntelligenceResult | null; now?: Date; seams?: Partial<DecisionSeams> } = {}): Promise<(Persisted & { draft: DecisionDraft }) | null> {
  const seams = { ...defaultSeams(), ...opts.seams };
  const input = await loadDecisionInput(clientId, { now: opts.now, result: opts.result, seams });
  if (!input) return null;
  const built = buildDecision(input);
  const saved = await persistDecision(clientId, built, input.legacy);
  if (saved.created) {
    await seams.events.emit({ type: "nba.decision.created", clientId, decisionId: saved.id, correlationId: saved.correlationId, payload: { result: built.draft.result, programme: built.draft.programme, agrees: built.disagreement.agrees } });
  }
  return { ...saved, draft: built.draft };
}
