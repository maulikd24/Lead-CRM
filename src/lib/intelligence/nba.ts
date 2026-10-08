import type { CustomerFacts } from "./facts";
import type { AcceptanceMap } from "./acceptance";
import { isHniProfile } from "./acceptance";
import type { Situation } from "./situations";
import type { NbaPriority } from "./constants";
import {
  type AssetClass,
  type LifecycleStage,
  type NbaAction,
  type NbaOwner,
  type NbaProgramme,
  type NbaTiming,
} from "./constants";

const DAY = 24 * 60 * 60 * 1000;

export type NextBestActionV2 = {
  programme: NbaProgramme;
  action: NbaAction;
  topic: string | null;
  reason: string;
  priority: NbaPriority;
  owner: NbaOwner;
  timing: NbaTiming;
  priorityScore: number;
  talkingPoints: string[];
  /** What the RM (or an AI agent) should avoid raising right now. */
  doNotDiscuss: string[];
};

const inr = (value: number) => (value >= 10_000_000 ? `₹${(value / 10_000_000).toFixed(2)} Cr` : value >= 100_000 ? `₹${(value / 100_000).toFixed(1)} L` : `₹${Math.round(value).toLocaleString("en-IN")}`);

type Candidate = { programme: NbaProgramme; action: NbaAction; topic: string | null; reason: string; priority: NbaPriority; owner: NbaOwner; timing?: NbaTiming; assetClass?: AssetClass; bonus?: number; talkingPoints: string[] };

const BASE_SCORE: Record<NbaPriority, number> = { High: 75, Medium: 50, Low: 20 };
const DEFAULT_TIMING: Record<NbaPriority, NbaTiming> = { High: "Today", Medium: "This Week", Low: "Later" };

/** Programmes an AI agent could run end to end. Only used when agents are switched on. */
const AGENT_FRIENDLY: NbaProgramme[] = ["Complete KYC", "Fund account", "First transaction", "Broking activation / reactivation", "MF / SIP opportunity", "Tax-planning discussion"];

/** Asset classes the customer shouldn't be pitched right now, with why. */
export function blockedAssetClasses(f: CustomerFacts, acceptance: AcceptanceMap): Map<AssetClass, string> {
  const blocked = new Map<AssetClass, string>();
  const recent = (date: Date) => f.now.getTime() - date.getTime() <= 30 * DAY;
  for (const i of f.insights) {
    if (i.kind === "DECLINED" && i.assetClass && recent(i.occurredAt)) blocked.set(i.assetClass as AssetClass, `Recently declined ${i.assetClass} (${i.occurredAt.toISOString().slice(0, 10)}) — avoid repeating the pitch`);
  }
  for (const o of f.outcomes) {
    if ((o.outcome === "NOT_INTERESTED" || o.outcome === "NOT_RELEVANT") && o.assetClass && recent(o.createdAt)) blocked.set(o.assetClass as AssetClass, `Said ${o.outcome === "NOT_INTERESTED" ? "not interested" : "not relevant"} to ${o.assetClass} on ${o.createdAt.toISOString().slice(0, 10)}`);
  }
  for (const m of f.manualAcceptance) {
    if (m.level === "LOW") blocked.set(m.assetClass as AssetClass, `RM marked ${m.assetClass} acceptance Low`);
  }
  void acceptance;
  // PMS and AIF are pitched together ("PMS / AIF opportunity"), so turning down one rests the other too.
  for (const [from, to] of [["PMS", "AIF"], ["AIF", "PMS"]] as const) {
    const why = blocked.get(from);
    if (why && !blocked.has(to)) blocked.set(to, `${why.replace(/^Recently declined /, "Declined ")} — PMS and AIF are pitched together`);
  }
  return blocked;
}

function salesBlockReason(f: CustomerFacts, situations: Situation[]): string | null {
  const open = situations.find((s) => s.key === "service_issue");
  if (!open) return null;
  return open.severity === "high" ? "An open service issue — resolve it before any sales conversation" : "A recent conversation went badly — check in before selling";
}

function objectionFor(f: CustomerFacts, assetClass: AssetClass | undefined): string | null {
  if (!assetClass) return null;
  const o = f.insights.find((i) => i.kind === "OBJECTION" && i.assetClass === assetClass);
  return o ? `Address the earlier concern: ${o.text}` : null;
}

function score(c: Candidate, f: CustomerFacts): number {
  let value = BASE_SCORE[c.priority] + (c.bonus ?? 0);
  if (f.portfolio.aum >= 10_000_000) value += 5;
  if (isHniProfile(f)) value += 3;
  return Math.min(100, value);
}

/**
 * Turns a customer's facts, situations and acceptance into exactly one Next Best Action — including the equally
 * important answer "don't pitch right now". Pure: no database, no clock beyond f.now.
 */
export function computeNextBestAction(f: CustomerFacts, lifecycle: LifecycleStage, situations: Situation[], acceptance: AcceptanceMap, opts: { aiAgentsEnabled?: boolean } = {}): NextBestActionV2 {
  const blocked = blockedAssetClasses(f, acceptance);
  const salesBlocked = salesBlockReason(f, situations);
  const doNotDiscuss: string[] = [];
  if (salesBlocked) doNotDiscuss.push(`Sales topics — ${salesBlocked.toLowerCase()}`);
  for (const [assetClass, why] of blocked) doNotDiscuss.push(`${assetClass}: ${why}`);

  const finish = (c: Candidate): NextBestActionV2 => {
    let owner = c.owner;
    if (opts.aiAgentsEnabled && owner === "CRM" && AGENT_FRIENDLY.includes(c.programme) && !salesBlocked) owner = "AI Bot";
    const talkingPoints = [...c.talkingPoints];
    const objection = objectionFor(f, c.assetClass);
    if (objection) talkingPoints.push(objection);
    return {
      programme: c.programme,
      action: c.action,
      topic: c.topic,
      reason: c.reason,
      priority: c.priority,
      owner,
      timing: c.timing ?? DEFAULT_TIMING[c.priority],
      priorityScore: score(c, f),
      talkingPoints: talkingPoints.slice(0, 3),
      doNotDiscuss,
    };
  };

  const none = (reason: string, priority: NbaPriority = "Low"): NextBestActionV2 =>
    finish({ programme: "No Action / Do Not Pitch", action: "No Action", topic: null, reason, priority, owner: "RM", timing: "Later", talkingPoints: [] });

  if (lifecycle === "Lost") return none("Marked as not proceeding.");
  if (f.client.status === "ON_HOLD") return none("The client is on hold.");

  // --- 1. Service first: nothing is sold to someone with an unresolved problem.
  const service = situations.find((s) => s.key === "service_issue");
  const commitment = situations.find((s) => s.key === "commitment_pending");
  if (service?.severity === "high") {
    const fromTicket = f.insights.some((i) => i.kind === "COMPLAINT" && i.status === "OPEN" && i.sourceType === "TICKET");
    return finish({
      programme: "Service / relationship follow-up",
      action: "Call",
      topic: "Resolve the open issue",
      reason: `${service.detail.replace(/\.?\s*$/, ".")} Service resolution comes before any sales conversation.`,
      priority: "High",
      owner: fromTicket ? "Support" : "RM",
      bonus: 15,
      talkingPoints: ["Acknowledge the problem and apologise where due", "Confirm what has been done and what happens next, with dates", "Do not raise new products on this call"],
    });
  }
  if (commitment?.severity === "high") {
    return finish({
      programme: "Service / relationship follow-up",
      action: "Follow-up",
      topic: "Pending commitment",
      reason: `${commitment.label}: ${commitment.detail}`,
      priority: "High",
      owner: "RM",
      bonus: 12,
      talkingPoints: [`Close the loop: ${commitment.detail}`, "Tell the client when it will be done if it still isn't", "Log the outcome so it stops showing as pending"],
    });
  }

  // --- 2. Onboarding: the stage engine knows what's blocking this customer.
  const onboarding = f.onboarding;
  if ((lifecycle === "Lead" || lifecycle === "Contacted" || lifecycle === "KYC" || lifecycle === "Value unlock") && onboarding.kind !== "no_action_needed") {
    const kycPhase = lifecycle === "Lead" || lifecycle === "Contacted" || lifecycle === "KYC";
    const stuckDays = Math.floor((f.now.getTime() - f.stage.enteredAt.getTime()) / DAY);
    const reminder = onboarding.suggestedTemplateCategory !== null && f.hasContacted;
    return finish({
      programme: kycPhase ? "Complete KYC" : "Fund account",
      action: onboarding.kind === "contact_client" ? "Call" : reminder ? "WhatsApp" : "Call",
      topic: onboarding.label,
      reason: onboarding.detail,
      priority: stuckDays >= 3 || lifecycle === "Lead" ? "High" : "Medium",
      owner: reminder ? "CRM" : "RM",
      bonus: stuckDays >= 3 ? 8 : 0,
      talkingPoints: kycPhase
        ? ["Explain what is still needed and how long it takes", "Offer to help with documents or e-sign on this call", "Mention what unlocks once KYC is done"]
        : ["KYC is done — the account is ready for funds", "Walk through the quickest funding route (UPI / NEFT)", "Ask if they'd prefer transferring existing holdings instead"],
    });
  }
  if ((lifecycle === "Value unlock" || lifecycle === "Funded") && (onboarding.kind === "schedule_dealer_intro" || onboarding.kind === "follow_up_dealer_intro" || onboarding.kind === "mark_onboarding_completed")) {
    return finish({ programme: "First transaction", action: "Follow-up", topic: onboarding.label, reason: onboarding.detail, priority: "Medium", owner: "RM", talkingPoints: ["Confirm the dealer introduction happened", "Ask what they want to buy first", "Share how to place the first order"] });
  }

  // --- 3. Relationship opportunities, each with the reason it applies; the strongest eligible one wins.
  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  const eligible = (assetClass: AssetClass): boolean => {
    if (salesBlocked) return false;
    const why = blocked.get(assetClass);
    if (why) {
      skipped.push(why);
      return false;
    }
    return true;
  };
  const level = (assetClass: AssetClass) => acceptance[assetClass].level;
  const hni = isHniProfile(f);

  const funded = situations.find((s) => s.key === "funded_no_first_transaction");
  if (funded) {
    candidates.push({ programme: "First transaction", action: "Call", topic: "Place the first trade", reason: funded.detail, priority: funded.severity === "high" ? "High" : "Medium", owner: "RM", bonus: 6, talkingPoints: ["Ask what they plan to start with", "Offer a simple starter idea matched to their risk profile", "Explain how to place the first order"] });
  }

  const outside = situations.find((s) => s.key === "large_portfolio_outside");
  if (outside && level("Broking") !== "LOW" && eligible("Broking")) {
    candidates.push({ programme: "Demat portfolio transfer", action: "Call", topic: "Consolidate holdings", reason: outside.detail, priority: hni ? "High" : "Medium", owner: "RM", assetClass: "Broking", bonus: 4, talkingPoints: ["Ask which broker holds the portfolio and whether they're happy with it", "Explain the free transfer process and what stays the same", "Offer a portfolio review once it's moved"] });
  }
  const mfTransfer = situations.find((s) => s.key === "mf_transfer_available");
  if (mfTransfer && eligible("Mutual Funds")) {
    candidates.push({ programme: "Mutual fund portfolio transfer", action: "Call", topic: "Bring mutual funds across", reason: mfTransfer.detail, priority: "Medium", owner: "RM", assetClass: "Mutual Funds", talkingPoints: ["Ask how their funds are performing today", "Explain how moving them to Allvest gives a single view", "Offer to do the transfer paperwork for them"] });
  }

  const dormant = situations.find((s) => s.key === "dormant_trading");
  if (dormant && eligible("Broking")) {
    const long = f.trading.last ? f.now.getTime() - f.trading.last.getTime() > 180 * DAY : false;
    candidates.push({ programme: "Broking activation / reactivation", action: "WhatsApp", topic: "Reactivate trading", reason: dormant.detail, priority: "Medium", owner: long ? "RM" : "CRM", assetClass: "Broking", bonus: 6, talkingPoints: ["Ask what changed — market view, fees or service", "Share one relevant, timely idea", "Offer a call if they'd like to talk it through"] });
  }

  const interest = situations.find((s) => s.key === "recent_interest");
  if (interest) {
    const assetClass = interest.assetClass;
    const programme: NbaProgramme =
      assetClass === "PMS" || assetClass === "AIF" ? "PMS / AIF opportunity" : assetClass === "Mutual Funds" ? "MF / SIP opportunity" : assetClass === "Tax Planning" ? "Tax-planning discussion" : assetClass === "Broking" ? "Broking activation / reactivation" : "Wealth Health Review";
    if (!assetClass || eligible(assetClass)) {
      candidates.push({ programme, action: "Call", topic: assetClass ?? "Stated interest", reason: `${interest.detail}`, priority: "High", owner: "RM", assetClass, bonus: 8, talkingPoints: ["Pick up where the last conversation left off", "Ask what outcome they're hoping for", "Move to a suitability discussion if they're keen"] });
    }
  }

  const review = situations.find((s) => s.key === "no_portfolio_review");
  if (review && !salesBlocked) {
    candidates.push({ programme: "Wealth Health Review", action: "Review", topic: "Portfolio review", reason: review.detail, priority: review.severity === "high" ? "High" : "Medium", owner: "RM", talkingPoints: [`Portfolio is about ${inr(f.portfolio.aum)} — walk through where it sits today`, "Compare against their goals and risk profile", "Agree two or three changes to consider"] });
  }
  const concentration = situations.find((s) => s.key === "portfolio_concentration");
  if (concentration && !salesBlocked) {
    const top = [...f.portfolio.allocation].sort((a, b) => b.pct - a.pct)[0];
    candidates.push({ programme: "Portfolio rebalance", action: "Review", topic: top ? `${top.bucket} is ${Math.round(top.pct)}% of the portfolio` : "Diversify", reason: concentration.detail, priority: "Medium", owner: "RM", bonus: 2, talkingPoints: ["Show how much of the portfolio sits in one place", "Discuss the downside if that one area falls", "Suggest a gradual rebalance, not a sudden switch"] });
  }

  if (hni && (level("PMS") !== "LOW" || level("AIF") !== "LOW") && (f.lastActivityAt || f.trading.count > 0) && lifecycle !== "Funded") {
    const assetClass: AssetClass = level("PMS") !== "LOW" ? "PMS" : "AIF";
    if (eligible(assetClass)) {
      candidates.push({ programme: "PMS / AIF opportunity", action: "Call", topic: assetClass, reason: `${assetClass} acceptance is ${level(assetClass).toLowerCase()} for this ${f.client.customerCategory === "HNI" ? "HNI " : ""}customer${f.portfolio.aum ? ` with about ${inr(f.portfolio.aum)} invested` : ""}.`, priority: level(assetClass) === "HIGH" ? "High" : "Medium", owner: "RM", assetClass, talkingPoints: ["Start from their portfolio, not the product", "Check appetite for lock-in and downside risk", "Move to a suitability discussion only if there's interest"] });
    }
  }

  if (level("Mutual Funds") === "HIGH" && !f.trading.hasSip && !f.portfolio.holds.includes("Mutual Funds") && eligible("Mutual Funds")) {
    candidates.push({ programme: "MF / SIP opportunity", action: "WhatsApp", topic: "Start a SIP", reason: "Open to mutual funds and no SIP or mutual-fund holding yet.", priority: "Low", owner: "CRM", assetClass: "Mutual Funds", talkingPoints: ["Suggest starting small and regular", "Match the fund type to their risk profile", "Offer to set it up in one step"] });
  }
  if (level("Tax Planning") === "HIGH" && eligible("Tax Planning")) {
    candidates.push({ programme: "Tax-planning discussion", action: "WhatsApp", topic: "Tax-saving options", reason: acceptance["Tax Planning"].reason, priority: "Low", owner: "CRM", timing: "Trigger-based", assetClass: "Tax Planning", talkingPoints: ["Ask what they have already used this year", "Share one or two suitable tax-saving options", "Offer a quick call before the deadline"] });
  }

  if (commitment) {
    candidates.push({ programme: "Service / relationship follow-up", action: "Follow-up", topic: "Pending commitment", reason: `${commitment.label}: ${commitment.detail}`, priority: "Medium", owner: "RM", talkingPoints: [`Follow up on: ${commitment.detail}`, "Confirm the date it will be done", "Log the outcome afterwards"] });
  }
  if (service) {
    candidates.push({ programme: "Service / relationship follow-up", action: "Call", topic: "Check in", reason: service.detail, priority: "Medium", owner: "RM", talkingPoints: ["Ask how they're finding the service", "Listen for any unresolved concern", "Hold off on sales until they're comfortable"] });
  }

  if (candidates.length === 0) {
    if (salesBlocked) return none(salesBlocked, "Medium");
    if (skipped.length > 0) return none(`Hold off on pitching: ${skipped[0]}.`, "Low");
    return none("Nothing needs attention right now.");
  }

  const best = [...candidates].sort((a, b) => score(b, f) - score(a, f))[0];
  return finish(best);
}
