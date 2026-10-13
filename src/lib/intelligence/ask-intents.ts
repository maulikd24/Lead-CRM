/**
 * "Ask the system" for management: six named intents, each a deterministic query over the existing read models. No AI call.
 * A question is matched to an intent by keywords; if none matches, the answer says so and lists the six. It never guesses.
 *
 * Every answer names the source it came from. The intent table is the only place these six are defined.
 */

import { getFunnelTotals, getTeamFollowups, getTopObjections, listCustomers, listHniPmsHighAcceptance, listKycNotFunded, type ClientListRow, type CustomerRow } from "./management";
import type { FunnelTotals } from "./management-panels";
import { pct } from "./management-panels";
import { normalizePan, normalizePhone, PAN_REGEX } from "@/lib/utils/normalize-contact";
import type { Prisma } from "@/generated/prisma/client";

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const DIGIT_RUN = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * True when free text carries a PAN, a 10-digit mobile (with or without +91 and separators) or an email. Uses the same
 * PAN format and phone normalisation as the rest of the app, so a value the app would store as a contact is caught here too.
 */
export function containsPersonalIdentifier(text: string): boolean {
  if (EMAIL.test(text)) return true;
  if (text.split(/[^A-Za-z0-9]+/).some((token) => token.length === 10 && PAN_REGEX.test(normalizePan(token)))) return true;
  return (text.match(DIGIT_RUN) ?? []).some((run) => normalizePhone(run).length === 10);
}

/**
 * Management view is aggregates only (access/policy.ts "management-intelligence", gate.ts): no answer names a customer or
 * carries a customer code. The customer-list intents answer with counts; the loaders only supply the totals.
 */

export type IntentId = "attention_today" | "hni_pms_high_acceptance" | "kyc_not_funded" | "rm_overdue_followups" | "common_objections" | "journey_loss";

export type AnswerRow = { label: string; detail: string };
export type IntentAnswer = { answer: string; rows: AnswerRow[] };

type Intent<D> = {
  id: IntentId;
  /** The question as the page offers it. */
  question: string;
  source: string;
  matches: (normalised: string) => boolean;
  load: (scope: Prisma.ClientWhereInput) => Promise<D>;
  build: (data: D) => IntentAnswer;
};

export type IntentResponse =
  | { ok: true; intent: IntentId; question: string; answer: string; rows: AnswerRow[]; source: string; asOf: string }
  | { ok: false; reason: "unsupported"; message: string; supported: string[] };

const has = (text: string, word: RegExp) => word.test(text);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function defineIntent<D>(intent: Intent<D>): Intent<unknown> {
  return intent as unknown as Intent<unknown>;
}

const ATTENTION_TODAY = defineIntent<{ total: number; rows: CustomerRow[] }>({
  id: "attention_today",
  question: "Which customers need attention today?",
  source: "CustomerIntelligence (nbaTiming = Today), ordered by priority score",
  matches: (q) => has(q, /\battention\b/),
  load: (scope) => listCustomers(scope, { nbaTiming: "Today" }, 10),
  build: ({ total }) => ({
    answer: total === 0 ? "No customer has a next action due today." : `${plural(total, "customer")} ${total === 1 ? "has" : "have"} a next action due today.`,
    rows: [],
  }),
});

const HNI_PMS = defineIntent<{ total: number; rows: ClientListRow[] }>({
  id: "hni_pms_high_acceptance",
  question: "Which HNI clients have high PMS acceptance?",
  source: "Client.customerCategory = HNI, AssetClassAcceptance (PMS, HIGH)",
  matches: (q) => has(q, /\bhni\b/) && has(q, /\bpms\b/),
  load: (scope) => listHniPmsHighAcceptance(scope, 10),
  build: ({ total }) => ({
    answer: total === 0 ? "No HNI customer is currently marked High for PMS acceptance." : `${plural(total, "HNI customer")} ${total === 1 ? "is" : "are"} marked High for PMS acceptance.`,
    rows: [],
  }),
});

const KYC_NOT_FUNDED = defineIntent<{ total: number; rows: ClientListRow[] }>({
  id: "kyc_not_funded",
  question: "Which KYC customers have not funded?",
  source: "KycRecord (APPROVED) without a FundingRecord or a successful funds-in payment",
  matches: (q) => has(q, /\bkyc\b/) && (has(q, /\bunfunded\b/) || has(q, /\b(not|no|never|without|yet)\b/) && has(q, /\bfund/)),
  load: (scope) => listKycNotFunded(scope, 10),
  build: ({ total }) => ({
    answer: total === 0 ? "Every KYC-approved customer has funded." : `${plural(total, "KYC-approved customer")} ${total === 1 ? "has" : "have"} not funded yet.`,
    rows: [],
  }),
});

const RM_OVERDUE = defineIntent<Awaited<ReturnType<typeof getTeamFollowups>>>({
  id: "rm_overdue_followups",
  question: "Which RMs have overdue follow-ups?",
  source: "Task (status OVERDUE) grouped by assignee, for customers in scope",
  matches: (q) => has(q, /\boverdue\b/) && has(q, /\b(rm|rms|agent|agents|relationship managers?|team)\b/),
  load: (scope) => getTeamFollowups(scope),
  build: (data) => {
    const late = data.rms.filter((r) => r.overdue > 0);
    const total = late.reduce((n, r) => n + r.overdue, 0);
    return {
      answer: late.length === 0 ? "No RM has overdue follow-ups right now." : `${plural(late.length, "RM")} ${late.length === 1 ? "has" : "have"} overdue follow-ups, ${total} in total.`,
      rows: late.map((r) => ({ label: r.rm, detail: `${r.overdue} overdue · ${r.open} open` })),
    };
  },
});

const OBJECTIONS = defineIntent<Array<{ text: string; assetClass: string | null }>>({
  id: "common_objections",
  question: "What are the most common customer objections?",
  source: "ConversationInsight (kind OBJECTION, last 90 days, latest 80 for customers in scope), grouped by identical wording",
  matches: (q) => has(q, /\bobjections?\b/),
  load: (scope) => getTopObjections(scope),
  build: (rows) => {
    const counts = new Map<string, { text: string; count: number; assetClasses: Map<string, number> }>();
    let withIdentifiers = 0;
    for (const row of rows) {
      // Free text can carry a PAN, phone or email. Such an objection is counted, never shown.
      if (containsPersonalIdentifier(row.text)) {
        withIdentifiers += 1;
        continue;
      }
      const text = row.text.trim().replace(/\s+/g, " ");
      const key = text.toLowerCase();
      const entry = counts.get(key) ?? { text, count: 0, assetClasses: new Map() };
      entry.count += 1;
      const asset = row.assetClass ?? "no asset class";
      entry.assetClasses.set(asset, (entry.assetClasses.get(asset) ?? 0) + 1);
      counts.set(key, entry);
    }
    const top = [...counts.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, 5);
    const rowsOut: AnswerRow[] = top.map((t) => {
      const assets = [...t.assetClasses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "no asset class";
      return { label: t.text.length > 120 ? `${t.text.slice(0, 117)}...` : t.text, detail: `${plural(t.count, "time")} · mostly ${assets}` };
    });
    if (withIdentifiers > 0) rowsOut.push({ label: "Objections containing a PAN, phone or email", detail: `${plural(withIdentifiers, "time")} · text not shown` });
    return {
      answer: rows.length === 0 ? "No objections were recorded in the last 90 days." : `Of ${plural(rows.length, "objection")} recorded in the last 90 days, these were the most common (identical wording only).`,
      rows: rowsOut,
    };
  },
});

const JOURNEY_LOSS = defineIntent<FunnelTotals>({
  id: "journey_loss",
  question: "Where are we losing customers in the journey?",
  source: "Client totals: leads, KYC approved, funded, activated (intelligence/management.ts getFunnelTotals)",
  matches: (q) => has(q, /\b(lose|losing|lost|loss|drop|dropping|leak|leaking|leave|leaving)\b/) && has(q, /\b(journey|funnel|stage|stages|where)\b/),
  load: (scope) => getFunnelTotals(scope),
  build: (t) => {
    const steps = [
      { label: "Leads and signups", count: t.leads },
      { label: "KYC approved", count: t.kyc },
      { label: "Funded", count: t.funded },
      { label: "Activated", count: t.activated },
    ];
    const transitions = steps.slice(1).map((s, i) => ({ from: steps[i], to: s, ratio: pct(s.count, steps[i].count) }));
    const weakest = transitions.filter((x) => x.ratio !== null).sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0))[0];
    return {
      answer:
        t.leads === 0
          ? "There are no leads or signups in scope yet."
          : weakest
            ? `The biggest loss is from ${weakest.from.label} to ${weakest.to.label}: ${weakest.ratio}% move on (${weakest.to.count} of ${weakest.from.count}).`
            : "Not enough data to find where customers are lost.",
      rows: steps.map((s, i) => ({ label: s.label, detail: i === 0 ? `${s.count}` : `${s.count} · ${transitions[i - 1].ratio ?? "—"}% of the previous stage` })),
    };
  },
});

/** The six intents, in the order the page offers them. Matching tries them in this order. */
export const INTENTS: Intent<unknown>[] = [RM_OVERDUE, ATTENTION_TODAY, HNI_PMS, KYC_NOT_FUNDED, OBJECTIONS, JOURNEY_LOSS];
export const INTENT_BY_ID = Object.fromEntries(INTENTS.map((i) => [i.id, i])) as Record<IntentId, Intent<unknown>>;
export const SUPPORTED_QUESTIONS = INTENTS.map((i) => i.question);

/** Lower-case, letters and digits only, single spaces. */
export function normaliseQuestion(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The intent a question maps to, or null when it is not one of the six. */
export function matchIntent(text: string): IntentId | null {
  const q = normaliseQuestion(text);
  if (q.length < 5) return null;
  const hit = INTENTS.find((i) => i.matches(q));
  return hit ? hit.id : null;
}

/** Answers one question from live data. Unsupported questions return a plain message and run no query. */
export async function answerQuestion(text: string, scope: Prisma.ClientWhereInput, now = new Date()): Promise<IntentResponse> {
  const id = matchIntent(text);
  if (!id) {
    return {
      ok: false,
      reason: "unsupported",
      message: "That is not one of the six questions this view can answer. Try one of these:",
      supported: SUPPORTED_QUESTIONS,
    };
  }
  const intent = INTENT_BY_ID[id];
  const data = await intent.load(scope);
  const built = intent.build(data);
  return { ok: true, intent: id, question: intent.question, answer: built.answer, rows: built.rows, source: intent.source, asOf: now.toISOString() };
}
