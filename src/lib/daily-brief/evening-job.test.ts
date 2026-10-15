import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { BRIEF_CHANNEL, runDailyBrief, type BriefStore } from "./job";
import type { BriefEmail } from "./sendgrid";
import { EVENING_CHANNEL, eveningBriefEnabled, inEveningWindow, runEveningBrief, type EveningRows, type EveningStore } from "./evening-job";
import { loadPrismaSendLog } from "./send-log";

const prismaUserFindMany = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findMany: prismaUserFindMany } } }));

// Mon 12 Oct 2026. 18:02 IST is 12:32 UTC.
const MON_1802_IST = new Date("2026-10-12T12:32:00Z");
const MON_1759_IST = new Date("2026-10-12T12:29:00Z");
const MON_1805_IST = new Date("2026-10-12T12:35:00Z");
const SUN_1802_IST = new Date("2026-10-11T12:32:00Z");
const SAT_1801_IST = new Date("2026-10-17T12:31:00Z");
const MON_0902_IST = new Date("2026-10-12T03:32:00Z");

const ENV = { NEXTAUTH_URL: "https://crm.allvest.test", SENDGRID_API_KEY: "SG.k", BRIEF_FROM: "Allvest CRM <crm@allvest.co>" };
const RM1 = { id: "rm1", name: "Priya Nair", email: "priya@allvest.test" };
const RM2 = { id: "rm2", name: "Ravi Menon", email: "ravi@allvest.test" };

const rowsFor = (over: Partial<EveningRows> = {}): EveningRows => ({
  calls: [
    { rmId: "rm1", payload: { direction: "Outbound", durationSeconds: 120 } },
    { rmId: "rm1", payload: { direction: "Inbound", durationSeconds: 0 } },
    { rmId: "rm2", payload: { direction: "Outbound", durationSeconds: 60 } },
  ],
  tasksDone: [{ rmId: "rm1", category: "FOLLOW_UP" }],
  tasksDue: [{ rmId: "rm1" }, { rmId: "rm1" }],
  newClients: [],
  stageMoves: [
    { rmId: "rm1", clientId: "c1" },
    { rmId: "rm1", clientId: "c1" },
    { rmId: "rm1", clientId: "c2" },
  ],
  ...over,
});

/** An in-memory send log. Same claim and finish rules as the real one; the log is keyed by (rm, date, channel). */
function memoryLog(rms = [RM1], log = new Map<string, { status: string; counts: unknown; error: string | null }>()) {
  const pendingFor = (date: string, channel: string) =>
    [...log.entries()]
      .filter(([key, v]) => key.endsWith(`|${date}|${channel}`) && v.status === "pending")
      .map(([key]) => ({ rmId: key.split("|")[0], name: rms.find((r) => r.id === key.split("|")[0])?.name ?? "" }));
  return {
    log,
    listRms: vi.fn(async () => rms),
    listPending: vi.fn(async (date: string, channel: string) => pendingFor(date, channel)),
    claim: vi.fn(async (rmId: string, date: string, channel: string, counts: unknown) => {
      const key = `${rmId}|${date}|${channel}`;
      const existing = log.get(key);
      if (!existing || existing.status === "failed" || existing.status === "skipped_empty") {
        log.set(key, { status: "pending", counts, error: null });
        return true;
      }
      return false;
    }),
    finish: vi.fn(async (rmId: string, date: string, channel: string, status: string, counts: unknown, error: string | null) => {
      log.set(`${rmId}|${date}|${channel}`, { status, counts, error });
    }),
  };
}

function eveningStore(rows: EveningRows = rowsFor(), rms = [RM1]) {
  const log = memoryLog(rms);
  const store: EveningStore & { log: typeof log.log } = { ...log, loadRows: vi.fn(async () => rows) } as EveningStore & { log: typeof log.log };
  return store;
}

describe("evening brief: flag and window", () => {
  it("is on unless DAILY_BRIEF_EVENING_ENABLED is exactly 0", () => {
    expect(eveningBriefEnabled({})).toBe(true);
    expect(eveningBriefEnabled({ DAILY_BRIEF_EVENING_ENABLED: "1" })).toBe(true);
    expect(eveningBriefEnabled({ DAILY_BRIEF_EVENING_ENABLED: "0" })).toBe(false);
  });

  it("does nothing while the flag is off, without touching the store", async () => {
    const store = eveningStore();
    expect(await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: { ...ENV, DAILY_BRIEF_EVENING_ENABLED: "0" }, store, send: vi.fn() })).toEqual({ skipped: "flag off" });
    expect(store.listRms).not.toHaveBeenCalled();
  });

  it("the send window is 18:00 to 18:04 IST, Monday to Saturday", () => {
    expect(inEveningWindow(MON_1802_IST)).toBe(true);
    expect(inEveningWindow(SAT_1801_IST)).toBe(true);
    expect(inEveningWindow(MON_1759_IST)).toBe(false);
    expect(inEveningWindow(MON_1805_IST)).toBe(false);
    expect(inEveningWindow(SUN_1802_IST)).toBe(false);
    expect(inEveningWindow(MON_0902_IST)).toBe(false); // the morning brief's time is not the evening window
  });

  it("a scheduled run outside the window does nothing", async () => {
    const store = eveningStore();
    expect(await runEveningBrief({ now: MON_1805_IST, scheduled: true, env: ENV, store, send: vi.fn() })).toEqual({ skipped: "outside send window" });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("a manual run (not scheduled) ignores the window", async () => {
    const result = await runEveningBrief({ now: MON_1805_IST, env: ENV, store: eveningStore(), send: vi.fn() });
    expect(result).toMatchObject({ dryRun: false, results: [{ rmId: "rm1", status: "sent" }] });
  });

  it("refuses to run without NEXTAUTH_URL, so the links are never wrong", async () => {
    expect(await runEveningBrief({ now: MON_1802_IST, env: { SENDGRID_API_KEY: "k", BRIEF_FROM: "a@b.co" }, store: eveningStore() })).toEqual({
      error: "NEXTAUTH_URL is not set; the brief's links need the app base URL",
    });
  });

  it("refuses to send without SendGrid settings, before claiming anything", async () => {
    const store = eveningStore();
    expect(await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: { NEXTAUTH_URL: ENV.NEXTAUTH_URL }, store })).toEqual({
      error: "SENDGRID_API_KEY and BRIEF_FROM must be set to send the brief",
    });
    expect(store.claim).not.toHaveBeenCalled();
  });
});

describe("evening brief: sending", () => {
  let send: Mock<(mail: BriefEmail) => Promise<unknown>>;
  beforeEach(() => {
    send = vi.fn(async () => ({ messageId: "m1" }));
  });

  it("dry run builds and counts for every RM, sends nothing and writes nothing", async () => {
    const store = eveningStore(rowsFor(), [RM1, RM2]);
    const result = await runEveningBrief({ now: MON_1802_IST, scheduled: true, dry: true, env: ENV, store, send });
    expect(send).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
    expect(store.log.size).toBe(0);
    expect(result).toMatchObject({ dryRun: true, date: "2026-10-12", results: [{ rmId: "rm1", status: "dry_run" }, { rmId: "rm2", status: "dry_run" }] });
  });

  it("counts calls, follow-ups, tasks, new clients and distinct stage moves for each RM", async () => {
    const rows = rowsFor({ newClients: [{ rmId: "rm1" }, { rmId: "rm1" }] });
    const store = eveningStore(rows, [RM1, RM2]);
    const result = await runEveningBrief({ now: MON_1802_IST, scheduled: true, dry: true, env: ENV, store, send });
    expect(result).toMatchObject({
      results: [
        { rmId: "rm1", status: "dry_run", calls: 2, answered: 1, unanswered: 1, talk_seconds: 120, follow_ups_done: 1, tasks_done: 1, tasks_due: 2, new_clients: 2, stage_moves: 2 },
        { rmId: "rm2", status: "dry_run", calls: 1, answered: 1, unanswered: 0, talk_seconds: 60, follow_ups_done: 0, tasks_done: 0, tasks_due: 0, new_clients: 0, stage_moves: 0 },
      ],
    });
  });

  it("sends one email per RM to the RM's address, claims first, and records sent on the evening channel", async () => {
    const store = eveningStore();
    const result = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: "priya@allvest.test", subject: expect.stringContaining("Your evening wrap") });
    expect(store.log.get(`rm1|2026-10-12|${EVENING_CHANNEL}`)).toMatchObject({ status: "sent" });
    expect(result).toMatchObject({ results: [{ rmId: "rm1", status: "sent" }] });
  });

  it("a second run on the same date sends nothing", async () => {
    const store = eveningStore();
    await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    const again = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ results: [{ rmId: "rm1", status: "already_done" }] });
  });

  it("a failed send is recorded and a later run in the window can retry it", async () => {
    const store = eveningStore();
    send.mockRejectedValueOnce(new Error("SendGrid responded 500"));
    const first = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    expect(first).toMatchObject({ results: [{ rmId: "rm1", status: "failed", error: "SendGrid responded 500" }] });
    const retry = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    expect(retry).toMatchObject({ results: [{ rmId: "rm1", status: "sent" }] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("an RM the store does not return (opted out or inactive) gets no email", async () => {
    const store = eveningStore(rowsFor(), []);
    const result = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ results: [] });
  });

  it("one RM's failure does not stop the others", async () => {
    const store = eveningStore(rowsFor(), [RM1, RM2]);
    send.mockRejectedValueOnce(new Error("bounce")).mockResolvedValueOnce({ messageId: "m2" });
    const result = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    expect(result).toMatchObject({ results: [{ rmId: "rm1", status: "failed" }, { rmId: "rm2", status: "sent" }] });
  });

  it("lists RMs with a pending evening row for today and never retries them", async () => {
    const store = eveningStore();
    store.log.set(`rm1|2026-10-12|${EVENING_CHANNEL}`, { status: "pending", counts: {}, error: null });
    const result = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store, send });
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ pending: [{ rmId: "rm1", name: "Priya Nair" }], results: [{ rmId: "rm1", status: "already_done" }] });
  });
});

describe("evening and morning briefs do not block each other", () => {
  it("a morning send on the same day does not stop the evening send, and the other way round", async () => {
    const log = memoryLog([RM1]);
    const morningStore: BriefStore = {
      ...log,
      listOpenClients: vi.fn(async () => []),
      claim: log.claim as BriefStore["claim"],
      finish: log.finish as BriefStore["finish"],
    };
    const morningSend = vi.fn(async () => ({}));
    const morningEnv = { ...ENV, DAILY_BRIEF_ENABLED: "1" };
    // Morning at 09:02 with nothing to do: logs skipped_empty on its own channel, so it proves the channel is separate.
    const morning = await runDailyBrief({ now: MON_0902_IST, scheduled: true, env: morningEnv, store: morningStore, send: morningSend });
    expect(morning).toMatchObject({ results: [{ rmId: "rm1", status: "skipped_empty" }] });
    expect(log.log.get(`rm1|2026-10-12|${BRIEF_CHANNEL}`)).toMatchObject({ status: "skipped_empty" });

    const eveningSend = vi.fn(async () => ({}));
    const evening = await runEveningBrief({ now: MON_1802_IST, scheduled: true, env: ENV, store: { ...log, loadRows: async () => rowsFor(), claim: log.claim, finish: log.finish }, send: eveningSend });
    expect(evening).toMatchObject({ results: [{ rmId: "rm1", status: "sent" }] });
    expect(eveningSend).toHaveBeenCalledTimes(1);
    expect(log.log.get(`rm1|2026-10-12|${EVENING_CHANNEL}`)).toMatchObject({ status: "sent" });
    // The morning row is untouched by the evening send.
    expect(log.log.get(`rm1|2026-10-12|${BRIEF_CHANNEL}`)).toMatchObject({ status: "skipped_empty" });
  });
});

describe("the send log's RM query (opt-out and inactive RMs)", () => {
  it("lists only active RMs who have not opted out of the brief", async () => {
    prismaUserFindMany.mockClear();
    const log = await loadPrismaSendLog();
    await log.listRms(null);
    expect(prismaUserFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: "RM", isActive: true, dailyBriefOptOut: false }) }));
  });
});
