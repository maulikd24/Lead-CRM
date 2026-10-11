import { beforeEach, describe, expect, it, vi } from "vitest";

const getCustomerTimeline = vi.fn();
vi.mock("@/lib/timeline/reader", () => ({ getCustomerTimeline: (...args: unknown[]) => getCustomerTimeline(...args) }));

import { FIRST_INVESTMENT_JOURNEY } from "./customer-journey";
import { loadCustomerJourney } from "./customer-journey-loader";

const ON = { JOURNEYS_ENABLED: "1" };
const rm = { id: "rm-1", role: "RM" as const };
const DAY = "2027-01-";
const evItem = (id: string, eventType: string, at: string) => ({ id: `event:${id}`, source: "event", eventType, at, title: eventType, kind: "fact" });
const page = (items: unknown[], olderNotShown: boolean, nextCursor: string | null) => ({ ok: true, items, nextCursor, olderNotShown, freshness: {} });

beforeEach(() => getCustomerTimeline.mockReset());

describe("loadCustomerJourney", () => {
  it("reads nothing while JOURNEYS_ENABLED is off", async () => {
    const r = await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: {} });
    expect(r).toEqual({ ok: false, reason: "disabled" });
    expect(getCustomerTimeline).not.toHaveBeenCalled();
  });

  it("returns nothing for a lead the RM does not own: the reader's not_found passes through with no evaluation", async () => {
    getCustomerTimeline.mockResolvedValue({ ok: false, reason: "not_found" });
    const r = await loadCustomerJourney("someone-elses-lead", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(getCustomerTimeline).toHaveBeenCalledWith("someone-elses-lead", expect.objectContaining({ viewer: rm, includeEvents: true }));
  });

  it("passes a forbidden result through (a role without client-360 view)", async () => {
    getCustomerTimeline.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect(await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("walks back through pages, keeps only event items, and evaluates the journey", async () => {
    getCustomerTimeline
      .mockResolvedValueOnce(page([evItem("2", "account.kyc.verified", `${DAY}04T10:00:00.000Z`), { id: "task:9", source: "task", at: `${DAY}05T00:00:00.000Z` }], true, "cur1"))
      .mockResolvedValueOnce(page([evItem("1", "account.kyc.started", `${DAY}01T10:00:00.000Z`)], false, null));
    const r = await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON, now: new Date(`${DAY}06T00:00:00.000Z`) });
    expect(getCustomerTimeline).toHaveBeenCalledTimes(2);
    expect(getCustomerTimeline.mock.calls[1][1]).toMatchObject({ before: "cur1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.historyComplete).toBe(true);
    expect(r.evaluation.steps.map((s) => s.status)).toEqual(["done", "done", "not_started"]);
    expect(r.evaluation.next?.stepId).toBe("first-investment");
  });

  it("reports an incomplete history when older events lie beyond the page walk", async () => {
    getCustomerTimeline.mockResolvedValue(page([], true, "more"));
    const r = await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON });
    expect(r.ok && r.historyComplete).toBe(false);
  });
});
