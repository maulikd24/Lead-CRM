import { beforeEach, describe, expect, it, vi } from "vitest";

// The real timeline reader and the real journeys loader, over a fake database. The KYC events carry the KycRecord ref, so the timeline
// hides them (its KYC milestone already stands for the record). The journey must still count them.
const db = vi.hoisted(() => ({ events: [] as unknown[], client: null as unknown, kyc: null as unknown }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, model: string) => ({
      findMany: async () => (model === "customerEvent" ? db.events : []),
      findUnique: async () => (model === "client" ? db.client : model === "kycRecord" ? db.kyc : null),
    }),
  }),
}));
vi.mock("@/lib/access/policy", () => ({ can: () => true }));
vi.mock("@/lib/clients/access", () => ({ canOpen360: () => true }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async () => [] }));
vi.mock("@/lib/c360/timeline", () => ({ dropMirroredMessageActivities: (activities: unknown[]) => activities }));
vi.mock("@/lib/events/flag", () => ({ customerEventsEnabled: () => true }));

import { getCustomerTimeline } from "@/lib/timeline/reader";
import { FIRST_INVESTMENT_JOURNEY } from "./customer-journey";
import { loadCustomerJourney } from "./customer-journey-loader";

const ON = { JOURNEYS_ENABLED: "1" };
const rm = { id: "rm-1", role: "RM" as const };
const ref = { table: "KycRecord", id: "kyc-1" };
const event = (id: string, eventType: string, occurredAt: string) => ({ id, eventType, occurredAt: new Date(occurredAt), receivedAt: new Date(occurredAt), actorType: "SYSTEM", metadata: { ref }, late: false, schemaVersion: 1 });

beforeEach(() => {
  db.client = { assignedToId: "rm-1", isDeleted: false, mergedIntoId: null };
  db.kyc = { id: "kyc-1", status: "APPROVED", submissionDate: new Date("2027-01-02T00:00:00Z"), completionDate: new Date("2027-01-04T00:00:00Z"), updatedAt: new Date("2027-01-04T00:00:00Z") };
  db.events = [event("e2", "account.kyc.verified", "2027-01-04T00:00:00Z"), event("e1", "account.kyc.started", "2027-01-01T00:00:00Z")];
});

describe("journey coverage of timeline-hidden events", () => {
  it("the timeline hides the KYC events, but the journey still counts them", async () => {
    const timeline = await getCustomerTimeline("c1", { viewer: rm, includeEvents: true, now: new Date("2027-01-06T00:00:00Z") });
    expect(timeline.ok).toBe(true);
    if (!timeline.ok) return;
    expect(timeline.items.some((i) => i.source === "event")).toBe(false);
    expect(timeline.items.some((i) => i.source === "milestone" && i.title === "KYC approved")).toBe(true);

    const r = await loadCustomerJourney("c1", FIRST_INVESTMENT_JOURNEY, { viewer: rm, env: ON, now: new Date("2027-01-06T00:00:00Z") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evaluation.steps.map((s) => s.status)).toEqual(["done", "done", "not_started"]);
    expect(r.evaluation.next?.stepId).toBe("first-investment");
  });
});
