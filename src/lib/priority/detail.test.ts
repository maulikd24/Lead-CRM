import { describe, expect, it } from "vitest";
import { ASSET_CLASSES } from "@/lib/intelligence/constants";
import { blockedClassesFrom, buildTalkingPoints, doNotDiscussList, eventLabel, summariseInteraction } from "./detail";

const NOW = new Date("2026-10-09T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("eventLabel and summariseInteraction", () => {
  it("names known CustomerEvent types in plain words and reads unknown ones as their own words", () => {
    expect(eventLabel("call.logged")).toBe("call");
    expect(eventLabel("customer.stage.changed")).toBe("stage change");
    expect(eventLabel("payments.refund_issued")).toBe("payments refund issued");
  });

  it("says when there is no interaction on record", () => {
    expect(summariseInteraction(null, 0)).toBe("No interaction on record.");
  });

  it("gives the last event, its date, who did it, and the 30-day count", () => {
    expect(summariseInteraction({ eventType: "call.logged", occurredAt: new Date("2026-10-05T04:00:00Z"), actorType: "RM" }, 3)).toBe(
      "Last: call on 2026-10-05 by RM. 3 events in the last 30 days.",
    );
    expect(summariseInteraction({ eventType: "message.sent", occurredAt: daysAgo(40), actorType: "AI_AGENT" }, 0)).toBe(
      "Last: message on 2026-08-30 by AI agent. No events in the last 30 days.",
    );
  });
});

describe("doNotDiscussList", () => {
  const base = { openComplaints: 0, declines: [], programme: "Wealth Health Review", nbaReason: "", nbaDoNotDiscuss: [], now: NOW };

  it("lists an open complaint first, then recent declines, then the do-not-pitch rule, then NBA items", () => {
    const out = doNotDiscussList({
      ...base,
      openComplaints: 1,
      declines: [{ assetClass: "PMS", createdAt: daysAgo(5) }],
      programme: "No Action / Do Not Pitch",
      nbaReason: "The client is on hold.",
      nbaDoNotDiscuss: ["Broking: Recently declined Broking"],
    });
    expect(out).toEqual([
      "Open complaint: resolve it before any sales conversation",
      "PMS: said not interested on 2026-10-04; do not repeat the pitch",
      "Do not pitch now: The client is on hold.",
      "Broking: Recently declined Broking",
    ]);
  });

  it("leaves out declines older than 30 days or dated in the future, and de-duplicates", () => {
    const out = doNotDiscussList({
      ...base,
      declines: [{ assetClass: "AIF", createdAt: daysAgo(31) }, { assetClass: "AIF", createdAt: new Date(NOW.getTime() + 86_400_000) }, { assetClass: null, createdAt: daysAgo(1) }],
      nbaDoNotDiscuss: ["Sales topics", "Sales topics"],
    });
    expect(out).toEqual(["Sales topics"]);
  });
});

describe("blockedClassesFrom", () => {
  it("returns classes declined within 30 days or named in do-not-discuss", () => {
    const blocked = blockedClassesFrom(["Bonds: Recently declined Bonds"], [{ assetClass: "PMS", createdAt: daysAgo(3) }, { assetClass: "AIF", createdAt: daysAgo(60) }], ASSET_CLASSES, NOW);
    expect(blocked).toEqual(["PMS", "Bonds"]);
  });
});

describe("buildTalkingPoints", () => {
  const base = { commitments: [], lastInteraction: null, highAcceptance: [], nbaTalkingPoints: [], blockedClasses: [], now: NOW };

  it("starts with an open promise, then the last contact, then High acceptance, capped at three", () => {
    const points = buildTalkingPoints({
      ...base,
      commitments: [{ text: "send the KYC form", dueAt: daysAgo(2), overdue: true }],
      lastInteraction: { eventType: "call.logged", occurredAt: daysAgo(4), actorType: "RM" },
      highAcceptance: [{ assetClass: "Mutual Funds", reason: "Already invests" }],
      nbaTalkingPoints: ["Ask about SIPs"],
    });
    expect(points).toEqual([
      "Close the loop on: send the KYC form (was due 2026-10-07)",
      "Pick up from the last call on 2026-10-05",
      "Mutual Funds is a High acceptance: Already invests",
    ]);
  });

  it("never gives a talking point for a blocked asset class", () => {
    const points = buildTalkingPoints({
      ...base,
      highAcceptance: [{ assetClass: "PMS", reason: "HNI" }],
      nbaTalkingPoints: ["Explain PMS fees"],
      blockedClasses: ["PMS"],
    });
    expect(points.some((p) => p.includes("PMS"))).toBe(false);
  });

  it("pads to two points when the facts are thin", () => {
    const points = buildTalkingPoints(base);
    expect(points).toHaveLength(2);
  });
});
