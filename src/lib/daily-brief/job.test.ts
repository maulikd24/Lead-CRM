import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIEF_CHANNEL,
  dailyBriefEnabled,
  inBriefWindow,
  partitionClients,
  runDailyBrief,
  type BriefCounts,
  type BriefStore,
  type OpenClientRow,
} from "./job";

// Mon 12 Oct 2026. 09:02 IST is 03:32 UTC.
const MON_0902_IST = new Date("2026-10-12T03:32:00Z");
const MON_0859_IST = new Date("2026-10-12T03:29:00Z");
const MON_0905_IST = new Date("2026-10-12T03:35:00Z");
const SUN_0902_IST = new Date("2026-10-11T03:32:00Z");
const SAT_0901_IST = new Date("2026-10-17T03:31:00Z");

const ENV = { DAILY_BRIEF_ENABLED: "1", NEXTAUTH_URL: "https://crm.allvest.test", SENDGRID_API_KEY: "SG.k", BRIEF_FROM: "Allvest CRM <crm@allvest.co>" };

const row = (over: Partial<OpenClientRow> = {}): OpenClientRow => ({
  id: "c1",
  rmId: "rm1",
  name: "Client",
  phone: null,
  stage: "New Lead",
  source: "meta",
  stageEnteredAt: new Date(MON_0902_IST.getTime() - 60 * 60_000), // entered 1h ago
  slaHours: 4,
  createdAt: new Date(MON_0902_IST.getTime() - 60 * 60_000),
  ...over,
});

function memoryStore(rows: OpenClientRow[], rms = [{ id: "rm1", name: "Priya Nair", email: "priya@allvest.test" }]) {
  const logs = new Map<string, { status: string; counts: BriefCounts; error: string | null }>();
  const store: BriefStore & { logs: typeof logs } = {
    logs,
    listRms: vi.fn(async () => rms),
    listOpenClients: vi.fn(async () => rows),
    claim: vi.fn(async (rmId, date, channel, counts) => {
      const key = `${rmId}|${date}|${channel}`;
      const existing = logs.get(key);
      if (!existing) {
        logs.set(key, { status: "pending", counts, error: null });
        return true;
      }
      if (existing.status === "failed" || existing.status === "skipped_empty") {
        logs.set(key, { status: "pending", counts, error: null });
        return true;
      }
      return false;
    }),
    finish: vi.fn(async (rmId, date, channel, status, counts, error) => {
      logs.set(`${rmId}|${date}|${channel}`, { status, counts, error });
    }),
  };
  return store;
}

describe("gating", () => {
  it("is off unless DAILY_BRIEF_ENABLED is exactly 1", () => {
    expect(dailyBriefEnabled({})).toBe(false);
    expect(dailyBriefEnabled({ DAILY_BRIEF_ENABLED: "true" })).toBe(false);
    expect(dailyBriefEnabled({ DAILY_BRIEF_ENABLED: "1" })).toBe(true);
  });

  it("does nothing while the flag is off, without touching the store", async () => {
    const store = memoryStore([row()]);
    const out = await runDailyBrief({ now: MON_0902_IST, env: { ...ENV, DAILY_BRIEF_ENABLED: undefined }, store, scheduled: true });
    expect(out).toEqual({ skipped: "flag off" });
    expect(store.listRms).not.toHaveBeenCalled();
  });

  it("the send window is 09:00 to 09:04 IST, Monday to Saturday", () => {
    expect(inBriefWindow(MON_0859_IST)).toBe(false);
    expect(inBriefWindow(MON_0902_IST)).toBe(true);
    expect(inBriefWindow(MON_0905_IST)).toBe(false);
    expect(inBriefWindow(SUN_0902_IST)).toBe(false);
    expect(inBriefWindow(SAT_0901_IST)).toBe(true);
  });

  it("a scheduled run outside the window does nothing", async () => {
    const store = memoryStore([row()]);
    const out = await runDailyBrief({ now: MON_0905_IST, env: ENV, store, scheduled: true });
    expect(out).toEqual({ skipped: "outside send window" });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("a manual run (not scheduled) ignores the window", async () => {
    const store = memoryStore([row()]);
    const out = await runDailyBrief({ now: MON_0905_IST, env: ENV, store, dry: true });
    expect(out).toMatchObject({ dryRun: true, results: [{ rmId: "rm1", status: "dry_run" }] });
  });

  it("refuses to run without NEXTAUTH_URL, so the links are never wrong", async () => {
    const store = memoryStore([row()]);
    const out = await runDailyBrief({ now: MON_0902_IST, env: { ...ENV, NEXTAUTH_URL: "" }, store, dry: true });
    expect(out).toEqual({ error: expect.stringContaining("NEXTAUTH_URL") });
  });

  it("refuses to send without SendGrid settings, before claiming anything", async () => {
    const store = memoryStore([row()]);
    const out = await runDailyBrief({ now: MON_0902_IST, env: { ...ENV, SENDGRID_API_KEY: undefined }, store });
    expect(out).toEqual({ error: expect.stringContaining("SENDGRID_API_KEY") });
    expect(store.claim).not.toHaveBeenCalled();
  });
});

describe("partitionClients", () => {
  it("puts SLA-overdue clients first, due-today next, and the rest as new leads from the last 24h", () => {
    const now = MON_0902_IST;
    const rows = [
      // SLA 4h, entered 6h ago -> due 2h ago -> overdue
      row({ id: "over", stageEnteredAt: new Date(now.getTime() - 6 * 3_600_000), slaHours: 4 }),
      // SLA 24h, entered 2h ago -> due in 22h -> due today only if before IST midnight (it is 09:02 IST, so 22h is tomorrow)
      row({ id: "later", stageEnteredAt: new Date(now.getTime() - 2 * 3_600_000), slaHours: 24, createdAt: new Date(now.getTime() - 3 * 86_400_000) }),
      // SLA 4h, entered 1h ago -> due in 3h (09:02 + 3h = 12:02 IST, same IST day) -> due today
      row({ id: "today", stageEnteredAt: new Date(now.getTime() - 1 * 3_600_000), slaHours: 4 }),
      // no SLA (slaHours 0), created 1h ago -> new lead
      row({ id: "final", stage: "Onboarding Completed", slaHours: 0, createdAt: new Date(now.getTime() - 3_600_000) }),
      // referral lead has no SLA clock even with slaHours set -> new lead only if recent
      row({ id: "ref", source: "referral", slaHours: 4, stageEnteredAt: new Date(now.getTime() - 6 * 3_600_000), createdAt: new Date(now.getTime() - 3 * 86_400_000) }),
    ];
    const out = partitionClients(rows, now);
    expect(out.overdue.map((c) => c.id)).toEqual(["over"]);
    expect(out.dueToday.map((c) => c.id)).toEqual(["today"]);
    expect(out.newLeads.map((c) => c.id)).toEqual(["final"]);
  });

  it("does not list a client as a new lead when it is already overdue or due today", () => {
    const now = MON_0902_IST;
    const out = partitionClients([row({ id: "x", stageEnteredAt: new Date(now.getTime() - 9 * 3_600_000), slaHours: 4, createdAt: new Date(now.getTime() - 3_600_000) })], now);
    expect(out.overdue.map((c) => c.id)).toEqual(["x"]);
    expect(out.newLeads).toEqual([]);
  });
});

describe("runDailyBrief", () => {
  let rows: OpenClientRow[];
  beforeEach(() => {
    rows = [
      row({ id: "a", stageEnteredAt: new Date(MON_0902_IST.getTime() - 9 * 3_600_000), slaHours: 4, phone: "9876543210" }),
      row({ id: "b", stageEnteredAt: new Date(MON_0902_IST.getTime() - 1 * 3_600_000), slaHours: 4 }),
    ];
  });

  it("dry run builds and counts for every RM, sends nothing and writes nothing", async () => {
    const store = memoryStore(rows);
    const send = vi.fn();
    const out = await runDailyBrief({ now: MON_0902_IST, env: ENV, store, dry: true, send });
    expect(out).toEqual({
      dryRun: true,
      date: "2026-10-12",
      results: [{ rmId: "rm1", status: "dry_run", overdue: 1, due_today: 1, new_leads: 0 }],
    });
    expect(send).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
    expect(store.logs.size).toBe(0);
  });

  it("sends one email per RM, claims first, and records sent with the counts", async () => {
    const store = memoryStore(rows);
    const send = vi.fn().mockResolvedValue({});
    const out = await runDailyBrief({ now: MON_0902_IST, env: ENV, store, send, scheduled: true });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("priya@allvest.test");
    expect(mail.html).toContain("https://crm.allvest.test/clients/a");
    expect(out).toMatchObject({ results: [{ rmId: "rm1", status: "sent", overdue: 1, due_today: 1 }] });
    expect(store.logs.get(`rm1|2026-10-12|${BRIEF_CHANNEL}`)).toEqual({ status: "sent", counts: { overdue: 1, due_today: 1, new_leads: 0 }, error: null });
  });

  it("does not send a second time for an RM already sent today (idempotent across ticks)", async () => {
    const store = memoryStore(rows);
    const send = vi.fn().mockResolvedValue({});
    await runDailyBrief({ now: MON_0902_IST, env: ENV, store, send, scheduled: true });
    const second = await runDailyBrief({ now: new Date(MON_0902_IST.getTime() + 2 * 60_000), env: ENV, store, send, scheduled: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ results: [{ rmId: "rm1", status: "already_done" }] });
  });

  it("a failed send is recorded and can be retried by a later tick in the window", async () => {
    const store = memoryStore(rows);
    const send = vi.fn().mockRejectedValueOnce(new Error("SendGrid responded 500")).mockResolvedValueOnce({});
    const first = await runDailyBrief({ now: MON_0902_IST, env: ENV, store, send, scheduled: true });
    expect(first).toMatchObject({ results: [{ rmId: "rm1", status: "failed", error: "SendGrid responded 500" }] });
    expect(store.logs.get(`rm1|2026-10-12|${BRIEF_CHANNEL}`)?.status).toBe("failed");

    const retry = await runDailyBrief({ now: new Date(MON_0902_IST.getTime() + 60_000), env: ENV, store, send, scheduled: true });
    expect(retry).toMatchObject({ results: [{ rmId: "rm1", status: "sent" }] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("an RM with nothing to do is logged as skipped_empty and gets no email", async () => {
    const store = memoryStore([]);
    const send = vi.fn();
    const out = await runDailyBrief({ now: MON_0902_IST, env: ENV, store, send, scheduled: true });
    expect(send).not.toHaveBeenCalled();
    expect(out).toMatchObject({ results: [{ rmId: "rm1", status: "skipped_empty" }] });
    expect(store.logs.get(`rm1|2026-10-12|${BRIEF_CHANNEL}`)?.status).toBe("skipped_empty");
  });

  it("one RM's failure does not stop the others", async () => {
    const rms = [
      { id: "rm1", name: "Priya Nair", email: "priya@allvest.test" },
      { id: "rm2", name: "Ravi Shah", email: "ravi@allvest.test" },
    ];
    const store = memoryStore([...rows, row({ id: "z", rmId: "rm2" })], rms);
    const send = vi.fn().mockRejectedValueOnce(new Error("bad address")).mockResolvedValueOnce({});
    const out = await runDailyBrief({ now: MON_0902_IST, env: ENV, store, send, scheduled: true });
    expect(out).toMatchObject({
      results: [
        { rmId: "rm1", status: "failed", error: "bad address" },
        { rmId: "rm2", status: "sent" },
      ],
    });
  });

  it("passes the RM filter through to the store", async () => {
    const store = memoryStore(rows);
    await runDailyBrief({ now: MON_0902_IST, env: ENV, store, dry: true, rm: "priya@allvest.test" });
    expect(store.listRms).toHaveBeenCalledWith("priya@allvest.test");
  });

  it("returns no results when there are no eligible RMs", async () => {
    const store = memoryStore(rows, []);
    const out = await runDailyBrief({ now: MON_0902_IST, env: ENV, store, dry: true });
    expect(out).toEqual({ dryRun: true, date: "2026-10-12", results: [] });
  });
});
