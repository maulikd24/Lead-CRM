import type { CustomerFacts } from "./facts";
import { ASSET_CLASSES, type AssetClass, type Level } from "./constants";

const DAY = 24 * 60 * 60 * 1000;
const LEVELS: Level[] = ["LOW", "MEDIUM", "HIGH"];

export type AcceptanceEntry = { level: Level; source: "rule" | "insight" | "outcome" | "manual"; reason: string };
export type AcceptanceMap = Record<AssetClass, AcceptanceEntry>;

function shift(level: Level, by: number): Level {
  return LEVELS[Math.max(0, Math.min(2, LEVELS.indexOf(level) + by))];
}

function istMonth(now: Date): number {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).getUTCMonth();
}

export function isHniProfile(f: CustomerFacts): boolean {
  const type = (f.client.clientType ?? "").toUpperCase();
  return f.client.customerCategory === "HNI" || type === "HNI" || type === "U-HNI" || (f.client.expectedInvestment ?? 0) >= 5_000_000 || f.portfolio.aum >= 5_000_000;
}

/** The starting point for an asset class, before anything the customer has said or done recently. */
function baseline(f: CustomerFacts, assetClass: AssetClass): { level: Level; reason: string } {
  const holds = f.portfolio.holds.includes(assetClass) || f.wealth.pmsAifInvested.includes(assetClass);
  const risk = (f.wealth.riskProfile ?? "").toLowerCase();
  const hni = isHniProfile(f);
  const riskShift = risk.startsWith("conserv") ? -1 : risk.startsWith("aggress") ? 1 : 0;

  switch (assetClass) {
    case "Mutual Funds":
      return holds || f.trading.hasSip ? { level: "HIGH", reason: "Already invests in mutual funds" } : { level: "MEDIUM", reason: "No mutual-fund history yet" };
    case "PMS": {
      if (holds) return { level: "HIGH", reason: "Already holds a PMS" };
      const level = shift(hni ? "MEDIUM" : "LOW", riskShift);
      return { level, reason: hni ? "HNI profile" : "Not an HNI profile" };
    }
    case "AIF": {
      if (holds) return { level: "HIGH", reason: "Already holds an AIF" };
      const eligible = hni && f.portfolio.aum >= 10_000_000;
      return { level: shift(eligible ? "MEDIUM" : "LOW", riskShift), reason: eligible ? "HNI with a portfolio of ₹1 Cr or more" : "Portfolio below the usual AIF range" };
    }
    case "Bonds":
      if (holds) return { level: "HIGH", reason: "Already holds bonds / deposits" };
      return risk.startsWith("conserv") ? { level: "HIGH", reason: "Conservative risk profile" } : { level: "MEDIUM", reason: "No fixed-income holdings yet" };
    case "Broking":
      if (holds || f.trading.last90 > 0) return { level: "HIGH", reason: "Actively trading" };
      return f.client.investmentCategory === "Wealth" && f.trading.count === 0 ? { level: "LOW", reason: "Signed up for wealth, not broking" } : { level: "MEDIUM", reason: "No recent trading" };
    case "Global Investments":
      return { level: shift(hni ? "MEDIUM" : "LOW", riskShift), reason: hni ? "HNI profile" : "No sign of global investing interest" };
    case "Tax Planning": {
      const season = istMonth(f.now) <= 2; // Jan–Mar
      return season ? { level: "HIGH", reason: "Tax-planning season (Jan–Mar)" } : { level: "MEDIUM", reason: "Relevant to most investors" };
    }
  }
}

type Event = { at: Date; level?: Level; nudge?: number; source: AcceptanceEntry["source"]; reason: string };

function eventsFor(f: CustomerFacts, assetClass: AssetClass): Event[] {
  const events: Event[] = [];
  const within = (date: Date, days: number) => f.now.getTime() - date.getTime() <= days * DAY;
  const day = (d: Date) => d.toISOString().slice(0, 10);

  for (const i of f.insights) {
    if (i.assetClass !== assetClass) continue;
    if (i.kind === "INTEREST" && within(i.occurredAt, 90)) events.push({ at: i.occurredAt, level: "HIGH", source: "insight", reason: `Showed interest on ${day(i.occurredAt)}` });
    if (i.kind === "DECLINED" && within(i.occurredAt, 90)) events.push({ at: i.occurredAt, level: "LOW", source: "insight", reason: `Declined on ${day(i.occurredAt)}` });
    if (i.kind === "OBJECTION" && within(i.occurredAt, 30)) events.push({ at: i.occurredAt, nudge: -1, source: "insight", reason: `Raised a concern on ${day(i.occurredAt)}` });
  }
  for (const o of f.outcomes) {
    if (o.assetClass !== assetClass || !within(o.createdAt, 90)) continue;
    if (o.outcome === "INTERESTED" || o.outcome === "CONVERTED") events.push({ at: o.createdAt, level: "HIGH", source: "outcome", reason: `Outcome logged: ${o.outcome === "CONVERTED" ? "converted" : "interested"} (${day(o.createdAt)})` });
    if (o.outcome === "NOT_INTERESTED" || o.outcome === "NOT_RELEVANT") events.push({ at: o.createdAt, level: "LOW", source: "outcome", reason: `Outcome logged: ${o.outcome === "NOT_INTERESTED" ? "not interested" : "not relevant"} (${day(o.createdAt)})` });
  }
  for (const op of f.opportunities) {
    if (op.assetClass !== assetClass) continue;
    if (op.stage === "LOST_DEFERRED" && within(op.updatedAt, 90)) events.push({ at: op.updatedAt, level: "LOW", source: "rule", reason: `Opportunity deferred${op.lostReason ? `: ${op.lostReason}` : ""}` });
    else if (op.stage !== "LOST_DEFERRED" && op.stage !== "IDENTIFIED" && op.stage !== "DISCUSSED") events.push({ at: op.updatedAt, level: "HIGH", source: "rule", reason: `Open ${assetClass} opportunity (${op.stage.toLowerCase().replace(/_/g, " ")})` });
  }
  return events;
}

/**
 * High / Medium / Low acceptance per asset class. Starts from the customer's profile and holdings, then the most
 * recent thing they said or did about that asset class wins (interest, a decline, a concern, an outcome an RM logged,
 * an opportunity). An RM's manual setting overrides everything until they change it.
 */
export function computeAcceptance(f: CustomerFacts): AcceptanceMap {
  const result = {} as AcceptanceMap;
  for (const assetClass of ASSET_CLASSES) {
    const base = baseline(f, assetClass);
    let entry: AcceptanceEntry = { level: base.level, source: "rule", reason: base.reason };

    // Replay what happened in order: interest lifts it, a decline drops it, and a concern nudges it down from wherever
    // it stands — so "interested, but worried about the lock-in" lands in the middle, not at the bottom.
    let level = base.level;
    const timeline = eventsFor(f, assetClass).sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const event of timeline) {
      level = event.nudge ? shift(level, event.nudge) : (event.level as Level);
      entry = { level, source: event.source, reason: event.reason };
    }

    const manual = f.manualAcceptance.find((m) => m.assetClass === assetClass);
    if (manual) entry = { level: manual.level, source: "manual", reason: "Set by the RM" };

    result[assetClass] = entry;
  }
  return result;
}
