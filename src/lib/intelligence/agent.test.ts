import { describe, expect, it, vi, beforeEach } from "vitest";

const refresh = vi.fn();
const compute = vi.fn();
const loadFacts = vi.fn();
const writes = vi.fn();

vi.mock("./refresh", () => ({ refreshCustomerIntelligence: (...a: unknown[]) => refresh(...a), computeIntelligence: (...a: unknown[]) => compute(...a) }));
vi.mock("./facts", () => ({ loadCustomerFacts: (...a: unknown[]) => loadFacts(...a) }));
vi.mock("@/lib/security/webhook-auth", () => ({ safeEqual: () => false }));
vi.mock("@/lib/db/prisma", () => {
  const write = () => writes();
  const prisma = new Proxy({}, { get: (_t, model: string) => new Proxy({}, { get: (_m, op: string) => {
    if (op === "findUnique") return async () => ({ id: "c1", clientCode: "CL-1", name: "Riya", mobile: null, email: null, preferredLanguage: "en", region: null, assignedTo: { name: "Asha" } });
    if (op === "findMany") return async () => [];
    return write; // any create/update/upsert/delete counts as a write
  } }) });
  return { prisma, basePrisma: prisma };
});

import { buildAgentBriefing } from "./agent";
import { ASSET_CLASSES } from "./constants";

const facts = { now: new Date("2026-10-09T00:00:00Z"), insights: [], client: { customerCategory: null }, portfolio: { aum: 0, holds: [], allocation: [] }, wealth: { riskProfile: null }, trading: { last90: 0 }, intel: {}, outcomes: [] };
const result = {
  facts, lifecycle: "KYC", acceptance: Object.fromEntries(ASSET_CLASSES.map((c) => [c, { level: "LOW", reason: "r" }])),
  situations: [], nba: { programme: "Complete KYC", action: "WhatsApp", topic: null, reason: "r", priority: "High", timing: "Today", owner: "AI Bot", talkingPoints: ["t"], doNotDiscuss: [] }, segments: [],
};

beforeEach(() => { vi.clearAllMocks(); refresh.mockResolvedValue(result); compute.mockReturnValue(result); loadFacts.mockResolvedValue(facts); });

describe("buildAgentBriefing persist:false", () => {
  it("never calls refreshCustomerIntelligence and performs no writes", async () => {
    const b = await buildAgentBriefing("c1", { persist: false });
    expect(b).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(loadFacts).toHaveBeenCalledWith("c1");
    expect(compute).toHaveBeenCalledWith(facts);
  });
  it("returns the same briefing as the persisting variant", async () => {
    const a = await buildAgentBriefing("c1", { persist: false });
    const b = await buildAgentBriefing("c1");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
  it("returns null when the customer does not exist", async () => {
    loadFacts.mockResolvedValue(null);
    expect(await buildAgentBriefing("c1", { persist: false })).toBeNull();
  });
});
