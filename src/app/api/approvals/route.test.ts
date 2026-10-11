import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGuard = vi.fn();
const listFor = vi.fn();
vi.mock("@/lib/access/api-guard", () => ({ apiGuard: (...a: unknown[]) => apiGuard(...a) }));
vi.mock("@/lib/policy/approvals/canonical/wiring", () => ({ approvalService: () => ({ listFor: (...a: unknown[]) => listFor(...a) }) }));

import { GET } from "./route";

const req = (qs = "") => new Request(`http://localhost/api/approvals${qs}`);
beforeEach(() => {
  vi.clearAllMocks();
  process.env.APPROVALS_INBOX_ENABLED = "1";
  apiGuard.mockResolvedValue({ ok: true, session: { user: { id: "u1", role: "RM", name: "Ravi" } } });
  listFor.mockResolvedValue({ items: [{ ref: "agent-proposal:p1", kind: "agent-proposal", requestedAt: new Date("2027-04-20T09:00:00Z"), expiresAt: null, decidedAt: null, evidence: [], actions: {} }], counts: { "agent-proposal": 1 } });
});

describe("GET /api/approvals", () => {
  it("asks the registry for view on the approvals area, and passes its refusal straight back", async () => {
    apiGuard.mockResolvedValue({ ok: false, response: new Response("no", { status: 403 }) });
    expect((await GET(req())).status).toBe(403);
    expect(apiGuard).toHaveBeenCalledWith("approvals", "view");
    expect(listFor).not.toHaveBeenCalled();
  });

  it("is 404 while the inbox flag is off, so the route does not reveal itself", async () => {
    delete process.env.APPROVALS_INBOX_ENABLED;
    expect((await GET(req())).status).toBe(404);
    expect(listFor).not.toHaveBeenCalled();
  });

  it("lists for the signed-in person only, defaulting to what awaits them, with dates as text", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(listFor).toHaveBeenCalledWith({ id: "u1", role: "RM", name: "Ravi" }, { tab: "awaiting", kind: undefined });
    const body = await res.json();
    expect(body.counts).toEqual({ "agent-proposal": 1 });
    expect(body.items[0]).toMatchObject({ ref: "agent-proposal:p1", requestedAt: "2027-04-20T09:00:00.000Z" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts a tab and a known kind, and ignores anything else", async () => {
    await GET(req("?tab=mine&kind=social-post"));
    expect(listFor).toHaveBeenLastCalledWith(expect.anything(), { tab: "mine", kind: "social-post" });
    await GET(req("?tab=everything&kind=%3Cscript%3E"));
    expect(listFor).toHaveBeenLastCalledWith(expect.anything(), { tab: "awaiting", kind: undefined });
  });
});
