import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./data-health-actions", () => ({ acknowledgeDataHealthAction: vi.fn(), runDataHealthNowAction: vi.fn(), retryDeadLetterAction: vi.fn() }));
vi.mock("./actions", () => ({ retryJobAction: vi.fn(), retryLeadsAction: vi.fn(), acknowledgeAlertAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/settings/control-plane", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import type { DataHealthData } from "@/lib/data-health/read-db";
import { DataHealthView } from "./data-health-view";

const NOW = new Date("2027-04-20T12:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);
const base = (over: Partial<DataHealthData> = {}): DataHealthData => ({
  enabled: true, lastRunAt: ago(20), summary: { high: 1, warn: 2, info: 0, acknowledged: 1 },
  checks: [{ key: "impossible_lifecycle", title: "Customer in a state that should not exist", severity: "HIGH", why: "w", fix: "Open the customer, find which record is wrong and correct it.", open: 1, acknowledged: 0 }],
  items: [
    { id: "i1", checkKey: "impossible_lifecycle", title: "Customer in a state that should not exist", severity: "HIGH", status: "OPEN", subjectType: "client", subjectId: "c1", clientId: "c1", clientCode: "CL-00042", detail: { code: "CL-00042", code2: "funded_without_kyc" }, firstSeenAt: ago(600), lastSeenAt: ago(5) },
    { id: "i2", checkKey: "unassigned_lead", title: "Lead with no relationship manager", severity: "WARN", status: "ACKNOWLEDGED", subjectType: "client", subjectId: "c2", clientId: "c2", clientCode: "CL-00043", detail: { waitingDays: 4 }, firstSeenAt: ago(5000), lastSeenAt: ago(5) },
  ],
  deadLetters: [{ id: "d1", consumer: "audit", eventType: "lead.created", attempts: 5, errorClass: "EventUnreadableError", lastFailedAt: ago(30) }],
  consumers: [{ consumer: "audit", pending: 3, lagSeconds: 40, lastRunAt: ago(2), lastError: null, processedTotal: 120 }],
  emitFailuresOpen: 2,
  ...over,
});

describe("DataHealthView", () => {
  const html = renderToStaticMarkup(<DataHealthView data={base()} now={NOW} />);
  it("leads with the counts, with the state in words and not only colour", () => {
    expect(html).toContain("Open work items");
    expect(html).toContain("1 high, 2 warning, 0 info; 1 acknowledged");
    expect(html).toMatch(/>High</);
    expect(html).toContain("Run checks now");
    expect(html).toContain("lag 40 s");
  });
  it("names a customer by code with a link, never by name, phone or email", () => {
    expect(html).toContain("CL-00042");
    expect(html).toContain('href="/clients/c1"');
    expect(html).not.toMatch(/@|\d{10}/);
  });
  it("offers Acknowledge on an open item and not on an acknowledged one", () => {
    expect(html).toContain("Acknowledge Customer in a state that should not exist");
    expect(html).not.toContain("Acknowledge Lead with no relationship manager");
    expect(html).toContain("Acknowledged");
  });
  it("lists a dead-lettered event with its error class and a Retry control", () => {
    expect(html).toContain("lead.created");
    expect(html).toContain("EventUnreadableError");
    expect(html).toContain("Retry lead.created for audit");
  });
  it("says so when customer events are off, and when there is nothing to do", () => {
    expect(renderToStaticMarkup(<DataHealthView data={base({ enabled: false })} now={NOW} />)).toContain("Customer events are off");
    const clear = renderToStaticMarkup(<DataHealthView data={base({ summary: { high: 0, warn: 0, info: 0, acknowledged: 0 }, items: [], checks: [], deadLetters: [], emitFailuresOpen: 0 })} now={NOW} />);
    expect(clear).toContain("No open data-health work items");
    expect(clear).toContain("All clear");
  });
});
