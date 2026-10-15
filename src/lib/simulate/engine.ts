import { consentDecision, type ConsentRow } from "@/lib/consent/decision";
import { CONSENT_POLICY, type ConsentChannel, type ConsentPolicy, type ConsentPurpose } from "@/lib/consent/policy";

/**
 * simulate(): the ONE dry-run primitive. Given an action and a list of customers, say who would be reached, who would be held back and
 * why, which channel each would get, and roughly what it would cost in AI calls, BEFORE anything is done. Pure: it reads nothing, writes
 * nothing, sends nothing. The caller loads TargetFacts (facts-db.ts) and decides what to do with the answer.
 *
 * First use: bulk follow-up task creation on the customer list. Interface for journeys: `simulateSequence` runs an ordered list of steps
 * (a journey is a list of SimActions) and `SimAction` is the only thing a journey step must describe to be previewable.
 * Rules mirror the live ones (consent ledger decision, do-not-contact, open complaint, recent contact, frequency cap); when the Decision
 * Engine's suppression rules ship, they plug in as extra `rules` without changing callers.
 */

export const SIM_LABEL = "Preview only. Nothing has been sent or created. Counts are as of now and can change.";

export type SimChannel = "whatsapp" | "call" | "email" | "sms";
export type SimAction = {
  id: string;
  /** The consent purpose this contact falls under. A sales message is MARKETING_COMMS, a service follow-up SERVICE_COMMS. */
  purpose: ConsentPurpose;
  /** "sales" is also held back by an open complaint; "service" is not. Default "sales" (the stricter reading). */
  kind?: "sales" | "service";
  /** In order of preference. The first channel that is usable and consented is chosen. */
  channels: SimChannel[];
  recentContactHours: number;
  frequencyCap: { maxContacts: number; windowDays: number };
  /** AI model calls this action would make per reached customer (a drafted message is one). */
  aiCallsPerTarget: number;
};

/** What the simulator needs to know about one customer. No contact detail, no free text: booleans, dates and consent rows. */
export type TargetFacts = {
  id: string;
  label: string;
  consent: readonly ConsentRow[];
  legacyMarketingConsentAt: Date | null;
  lastContactAt: Date | null;
  contactsInWindow: number;
  openComplaint: boolean;
  complianceConcern: boolean;
  hasMobile: boolean;
  hasEmail: boolean;
};

export type SuppressionReason = "do_not_contact" | "consent" | "open_complaint" | "compliance_concern" | "recent_contact" | "frequency_cap" | "no_channel";
export const REASON_LABEL: Record<SuppressionReason, string> = {
  do_not_contact: "Do not contact",
  consent: "No consent for this purpose",
  open_complaint: "Open complaint",
  compliance_concern: "Compliance concern",
  recent_contact: "Contacted recently",
  frequency_cap: "Contact limit reached",
  no_channel: "No usable channel",
};

export type SimOptions = { consentEnforced?: boolean; policy?: ConsentPolicy };

/** Assumption, not a quote: a planning rate for one drafted message, in minor units of INR (paise). Replace with measured cost when the AI gateway reports it. */
export const ASSUMED_COST_PER_AI_CALL_MINOR = 50;

export type SimResult = {
  actionId: string;
  dryRun: true;
  label: string;
  asOf: Date;
  total: number;
  eligible: { id: string; label: string; channel: SimChannel }[];
  suppressed: { id: string; label: string; reasons: SuppressionReason[] }[];
  reasonCounts: Partial<Record<SuppressionReason, number>>;
  channelSplit: Record<SimChannel, number>;
  estimate: { aiCalls: number; costMinor: number; currency: "INR"; note: string };
};

const CHANNEL_CONSENT: Record<SimChannel, ConsentChannel> = { whatsapp: "whatsapp", call: "call", email: "email", sms: "sms" };
const usable = (c: SimChannel, t: TargetFacts) => (c === "email" ? t.hasEmail : t.hasMobile);

export function simulate(action: SimAction, targets: readonly TargetFacts[], now: Date, opts: SimOptions = {}): SimResult {
  const enforced = opts.consentEnforced !== false;
  const policy = opts.policy ?? CONSENT_POLICY;
  const eligible: SimResult["eligible"] = [];
  const suppressed: SimResult["suppressed"] = [];
  const reasonCounts: SimResult["reasonCounts"] = {};
  const channelSplit: SimResult["channelSplit"] = { whatsapp: 0, call: 0, email: 0, sms: 0 };
  const kind = action.kind ?? "sales";

  for (const t of targets) {
    const reasons: SuppressionReason[] = [];
    if (t.complianceConcern) reasons.push("compliance_concern");
    if (kind === "sales" && t.openComplaint) reasons.push("open_complaint");
    if (t.lastContactAt && now.getTime() - t.lastContactAt.getTime() < action.recentContactHours * 3_600_000) reasons.push("recent_contact");
    if (t.contactsInWindow >= action.frequencyCap.maxContacts) reasons.push("frequency_cap");

    // Channel: the first preferred channel that is usable AND not denied by consent.
    let chosen: SimChannel | null = null;
    let sawUsable = false;
    let dnd = false;
    let consentDenied = false;
    for (const c of action.channels) {
      if (!usable(c, t)) continue;
      sawUsable = true;
      if (!enforced) {
        chosen = c;
        break;
      }
      const d = consentDecision(t.consent, action.purpose, CHANNEL_CONSENT[c], now, { legacyMarketingConsentAt: t.legacyMarketingConsentAt, policy });
      if (d.allowed) {
        chosen = c;
        break;
      }
      if (d.reason === "DO_NOT_CONTACT") dnd = true;
      else consentDenied = true;
    }
    if (!chosen) {
      if (!sawUsable) reasons.push("no_channel");
      else if (dnd) reasons.push("do_not_contact");
      else if (consentDenied) reasons.push("consent");
    }

    if (reasons.length > 0 || !chosen) {
      const finalReasons = reasons.length > 0 ? reasons : (["no_channel"] as SuppressionReason[]);
      suppressed.push({ id: t.id, label: t.label, reasons: finalReasons });
      for (const r of finalReasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    } else {
      eligible.push({ id: t.id, label: t.label, channel: chosen });
      channelSplit[chosen] += 1;
    }
  }

  const aiCalls = eligible.length * Math.max(0, action.aiCallsPerTarget);
  return {
    actionId: action.id,
    dryRun: true,
    label: SIM_LABEL,
    asOf: now,
    total: targets.length,
    eligible,
    suppressed,
    reasonCounts,
    channelSplit,
    estimate: { aiCalls, costMinor: aiCalls * ASSUMED_COST_PER_AI_CALL_MINOR, currency: "INR", note: `Assumes about ${ASSUMED_COST_PER_AI_CALL_MINOR / 100} rupees per AI call (a planning rate, not a quote).` },
  };
}

export type SequenceResult = { steps: { actionId: string; result: SimResult }[]; estimate: { aiCalls: number; costMinor: number } };

/**
 * A journey as a list of steps. Each step is simulated against the customers on their own facts; a step that would reach nobody is shown,
 * not hidden. (Journey-level carry-over, such as "step 2 only for those who did not reply", needs outcomes and arrives with the journey builder.)
 */
export function simulateSequence(steps: readonly SimAction[], targets: readonly TargetFacts[], now: Date, opts: SimOptions = {}): SequenceResult {
  const results = steps.map((s) => ({ actionId: s.id, result: simulate(s, targets, now, opts) }));
  return { steps: results, estimate: { aiCalls: results.reduce((n, s) => n + s.result.estimate.aiCalls, 0), costMinor: results.reduce((n, s) => n + s.result.estimate.costMinor, 0) } };
}
