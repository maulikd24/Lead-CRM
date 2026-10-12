import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ callSession: { updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const log = vi.hoisted(() => ({ logActivity: vi.fn() }));
vi.mock("@/lib/activities/log-activity", () => log);

import { MOCK_RING_MS, advanceMockCall, completeCallSession } from "./sessions";

const session = { id: "s1", clientId: "c1", userId: "rm1", provider: "exotel", providerCallId: "CA1", answeredAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  log.logActivity.mockResolvedValue({ id: "a1" });
});

describe("completeCallSession", () => {
  it("records the outcome once and logs one CALL activity by the user who placed it", async () => {
    db.callSession.updateMany.mockResolvedValue({ count: 1 });
    const done = await completeCallSession(session, { status: "completed", durationSeconds: 95 });
    expect(done).toMatchObject({ created: true, status: "COMPLETED" });
    expect(db.callSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1", status: { in: ["QUEUED", "IN_PROGRESS"] } } }));
    expect(log.logActivity).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", userId: "rm1", type: "CALL", payload: expect.objectContaining({ durationSeconds: 95, origin: "click-to-call" }) }));
    expect(db.callSession.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { activityId: "a1" } });
  });
  it("does nothing when the call already ended (a repeated callback)", async () => {
    db.callSession.updateMany.mockResolvedValue({ count: 0 });
    expect(await completeCallSession(session, { status: "completed" })).toEqual({ created: false });
    expect(log.logActivity).not.toHaveBeenCalled();
  });
  it("words an unanswered call plainly", async () => {
    db.callSession.updateMany.mockResolvedValue({ count: 1 });
    await completeCallSession(session, { status: "no-answer" });
    expect(log.logActivity.mock.calls[0][0].payload.message).toBe("Outbound call — no answer");
  });
});

describe("advanceMockCall", () => {
  const started = new Date("2026-10-12T05:00:00Z");
  const mock = { ...session, status: "QUEUED", mock: true, startedAt: started, endedAt: null, durationSeconds: null, activityId: null };
  it("keeps a test call ringing at first, then connects it", async () => {
    expect((await advanceMockCall(mock, new Date(started.getTime() + 1000))).status).toBe("QUEUED");
    const later = await advanceMockCall(mock, new Date(started.getTime() + MOCK_RING_MS + 1));
    expect(later.status).toBe("IN_PROGRESS");
    expect(db.callSession.updateMany).toHaveBeenCalledWith({ where: { id: "s1", status: "QUEUED" }, data: { status: "IN_PROGRESS", answeredAt: new Date(started.getTime() + MOCK_RING_MS) } });
  });
  it("never touches a real call", async () => {
    expect(await advanceMockCall({ ...mock, mock: false }, new Date(started.getTime() + 60_000))).toMatchObject({ status: "QUEUED" });
    expect(db.callSession.updateMany).not.toHaveBeenCalled();
  });
});
