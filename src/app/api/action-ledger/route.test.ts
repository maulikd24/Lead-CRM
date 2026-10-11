import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGuard = vi.fn();
const getActionLedger = vi.fn();
vi.mock("@/lib/access/api-guard", () => ({ apiGuard: (...a: unknown[]) => apiGuard(...a) }));
vi.mock("@/lib/ledger/read", () => ({ getActionLedger: (...a: unknown[]) => getActionLedger(...a) }));

import { GET as customer } from "./route";
import { GET as campaigns } from "./campaigns/route";
import { GET as investigate } from "./investigate/route";

const req = (path: string, qs = "") => new Request(`http://localhost/api/action-ledger${path}${qs}`);
const ok = { ok: true, entries: [], nextCursor: null, olderNotShown: false, counts: {}, hidden: { decisions: false }, stats: { queries: 5, rowsRead: 9 } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_ACTION_LEDGER = "1";
  process.env.NEXT_PUBLIC_ACTION_LEDGER_INVESTIGATE = "1";
  apiGuard.mockResolvedValue({ ok: true, session: { user: { id: "u1", role: "RM" } } });
  getActionLedger.mockResolvedValue(ok);
});

describe("GET /api/action-ledger (one customer)", () => {
  it("asks the registry for view on action-ledger and passes its refusal straight back", async () => {
    apiGuard.mockResolvedValue({ ok: false, response: new Response("no", { status: 403 }) });
    expect((await customer(req("", "?clientId=c1"))).status).toBe(403);
    expect(apiGuard).toHaveBeenCalledWith("action-ledger", "view");
    expect(getActionLedger).not.toHaveBeenCalled();
  });
  it("is 404 while the flag is off, so the route does not reveal itself", async () => {
    delete process.env.NEXT_PUBLIC_ACTION_LEDGER;
    expect((await customer(req("", "?clientId=c1"))).status).toBe(404);
    expect(getActionLedger).not.toHaveBeenCalled();
  });
  it("needs a clean clientId", async () => {
    expect((await customer(req(""))).status).toBe(400);
    expect((await customer(req("", "?clientId=a%20b%3Bdrop"))).status).toBe(400);
    expect(getActionLedger).not.toHaveBeenCalled();
  });
  it("calls the reader as the signed-in person, with strict paging and kinds, and never caches", async () => {
    const res = await customer(req("", "?clientId=c1&kind=task,bogus,message&limit=500&before=2027-05-01T00:00:00Z"));
    expect(res.status).toBe(200);
    expect(getActionLedger).toHaveBeenCalledWith({ type: "client", id: "c1" }, { viewer: { id: "u1", role: "RM" }, kinds: ["task", "message"], limit: 100, before: "2027-05-01T00:00:00.000Z" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).not.toHaveProperty("stats");
  });
  it("a customer the viewer may not open answers 404, exactly like a missing one; a refused role answers 403", async () => {
    getActionLedger.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await customer(req("", "?clientId=c1"))).status).toBe(404);
    getActionLedger.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect((await customer(req("", "?clientId=c1"))).status).toBe(403);
  });
});

describe("GET /api/action-ledger/campaigns (marketing, aggregated)", () => {
  it("is guarded by the campaigns area and reads the campaign subject", async () => {
    apiGuard.mockResolvedValue({ ok: true, session: { user: { id: "m1", role: "MARKETING" } } });
    const res = await campaigns(req("/campaigns", "?campaignId=camp-1"));
    expect(res.status).toBe(200);
    expect(apiGuard).toHaveBeenCalledWith("action-ledger-campaigns", "view");
    expect(getActionLedger).toHaveBeenCalledWith({ type: "campaign", id: "camp-1" }, expect.objectContaining({ viewer: { id: "m1", role: "MARKETING" } }));
  });
  it("refuses a role the registry refuses", async () => {
    apiGuard.mockResolvedValue({ ok: false, response: new Response("no", { status: 403 }) });
    expect((await campaigns(req("/campaigns"))).status).toBe(403);
  });
});

describe("GET /api/action-ledger/investigate (admin only)", () => {
  it("does not reveal itself to anyone but an admin (404) and is guarded by the investigate area", async () => {
    apiGuard.mockResolvedValue({ ok: false, response: new Response("Not found", { status: 404 }) });
    expect((await investigate(req("/investigate", "?q=x"))).status).toBe(404);
    expect(apiGuard).toHaveBeenCalledWith("action-ledger-investigate", "view", 404);
  });
  it("is 404 while its own flag is off", async () => {
    delete process.env.NEXT_PUBLIC_ACTION_LEDGER_INVESTIGATE;
    apiGuard.mockResolvedValue({ ok: true, session: { user: { id: "a1", role: "ADMIN" } } });
    expect((await investigate(req("/investigate", "?q=x"))).status).toBe(404);
  });
  it("maps the search mode to the subject type, and reports how the answer was built", async () => {
    apiGuard.mockResolvedValue({ ok: true, session: { user: { id: "a1", role: "ADMIN" } } });
    for (const [by, type] of [["correlation", "correlation"], ["customer", "client"], ["run", "agentRun"], ["approval", "approval"], ["nonsense", "correlation"]] as const) {
      getActionLedger.mockClear();
      const res = await investigate(req("/investigate", `?by=${by}&q=abc:123`));
      expect(res.status).toBe(200);
      expect(getActionLedger.mock.calls[0][0]).toEqual({ type, id: "abc:123" });
      expect((await res.json()).stats).toEqual({ queries: 5, rowsRead: 9 });
    }
  });
  it("needs a clean q", async () => {
    apiGuard.mockResolvedValue({ ok: true, session: { user: { id: "a1", role: "ADMIN" } } });
    expect((await investigate(req("/investigate", ""))).status).toBe(400);
    expect((await investigate(req("/investigate", "?q=%3Cscript%3E"))).status).toBe(400);
  });
});
