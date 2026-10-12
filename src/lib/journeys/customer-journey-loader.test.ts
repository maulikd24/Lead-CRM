import { beforeEach, describe, expect, it, vi } from "vitest";

const getCustomerEventFacts = vi.fn();
vi.mock("@/lib/timeline/reader", () => ({ getCustomerEventFacts: (...args: unknown[]) => getCustomerEventFacts(...args) }));

import { FIRST_INVESTMENT_JOURNEY } from "./customer-journey";
import { loadCustomerJourney } from "./customer-journey-loader";

const ON = { JOURNEYS_ENABLED: "1" };
const rm = { id: "rm-1", role: "RM" as const };
const DAY = "2027-01-";
const fact = (eventType: string, at: string) => ({ eventType, occurredAt: new Date(at) });

beforeEach(() => getCustomerEventFacts.mockReset());

describe("loadCustomerJourney", () => {
  it("reads nothing while JOURNEYS_ENABLED is off", async () => {
    const r = await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: {} });
    expect(r).toEqual({ ok: false, reason: "disabled" });
    expect(getCustomerEventFacts).not.toHaveBeenCalled();
  });

  it("returns not_found for a lead the RM does not own, with no evaluation", async () => {
    getCustomerEventFacts.mockResolvedValue({ ok: false, reason: "not_found" });
    const r = await loadCustomerJourney("someone-elses-lead", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(getCustomerEventFacts).toHaveBeenCalledWith("someone-elses-lead", { viewer: rm });
  });

  it("passes a forbidden result through (a role without client-360 view)", async () => {
    getCustomerEventFacts.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect(await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("evaluates the journey from every event the read returns", async () => {
    getCustomerEventFacts.mockResolvedValue({ ok: true, events: [fact("account.kyc.verified", `${DAY}04T10:00:00.000Z`), fact("account.kyc.started", `${DAY}01T10:00:00.000Z`)], complete: true });
    const r = await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON, now: new Date(`${DAY}06T00:00:00.000Z`) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.historyComplete).toBe(true);
    expect(r.evaluation.steps.map((s) => s.status)).toEqual(["done", "done", "not_started"]);
    expect(r.evaluation.next?.stepId).toBe("first-investment");
  });

  it("reports an incomplete history when the read could not cover every event", async () => {
    getCustomerEventFacts.mockResolvedValue({ ok: true, events: [], complete: false });
    const r = await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON });
    expect(r.ok && r.historyComplete).toBe(false);
  });
});
