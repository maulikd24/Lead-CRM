import { describe, expect, it } from "vitest";
import { approveProposal, rejectProposal, type DecideDeps, type StoredProposal } from "./decide";
import { canTransition } from "./proposal-state";

const RM = { id: "rm1", role: "RM" } as const;
const ADMIN = { id: "a1", role: "ADMIN" } as const;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<StoredProposal> = {}) {
  const store: StoredProposal = {
    id: "p1", agentKey: "wa_nudger", clientId: "c1", assignedToId: "rm1", status: "DRAFT", body: "Hi Riya, can I help with KYC?",
    expiresAt: new Date("2026-10-11T10:00:00Z"), ...over,
  };
  const sent: { body: string; userId: string }[] = [];
  const log = { failTo: null as string | null };
  const deps: DecideDeps = {
    load: async () => ({ ...store }),
    // Fake compare-and-set, like updateMany({ where: { id, status: from } }); the await yields so races interleave.
    transition: async (_id, from, to, patch, opts) => {
      await tick();
      if (log.failTo === to) throw new Error("db down");
      if (store.status !== from) return false;
      if (opts?.notExpiredAt && store.expiresAt.getTime() <= opts.notExpiredAt.getTime()) return false;
      if (!canTransition(from, to)) throw new Error(`illegal ${from}->${to}`);
      Object.assign(store, patch ?? {}, { status: to });
      return true;
    },
    send: async ({ user, body }) => { await tick(); sent.push({ body, userId: user.id }); return { messageId: "m1" }; },
    now: () => new Date("2026-10-09T10:00:00Z"),
  };
  return { store, sent, log, deps };
}

describe("approveProposal", () => {
  it("sends the draft as the assigned RM and marks it SENT", async () => {
    const { store, sent, deps } = setup();
    const res = await approveProposal(deps, { proposalId: "p1", user: RM });
    expect(res).toEqual({ ok: true, messageId: "m1" });
    expect(sent).toEqual([{ body: "Hi Riya, can I help with KYC?", userId: "rm1" }]);
    expect(store.status).toBe("SENT");
  });

  it("re-checks an edited message and refuses a promise", async () => {
    const { sent, store, deps } = setup();
    const res = await approveProposal(deps, { proposalId: "p1", user: RM, editedBody: "Guaranteed returns await you" });
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect(store.status).toBe("BLOCKED");
  });

  it("cannot be approved twice, and the second call sends nothing", async () => {
    const { sent, deps } = setup();
    expect((await approveProposal(deps, { proposalId: "p1", user: RM })).ok).toBe(true);
    const again = await approveProposal(deps, { proposalId: "p1", user: RM });
    expect(again.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("refuses an already-sent draft up front", async () => {
    const { sent, deps } = setup({ status: "SENT" });
    expect((await approveProposal(deps, { proposalId: "p1", user: RM })).ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("refuses an expired draft", async () => {
    const { sent, store, deps } = setup({ expiresAt: new Date("2026-10-09T09:00:00Z") });
    const res = await approveProposal(deps, { proposalId: "p1", user: RM });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/expired/i) });
    expect(sent).toHaveLength(0);
    expect(store.status).toBe("EXPIRED");
  });

  it("refuses when the draft expires between load and claim (expiry is part of the atomic claim)", async () => {
    const { sent, store, deps } = setup({ expiresAt: new Date("2026-10-09T10:00:00.500Z") });
    let calls = 0;
    deps.now = () => new Date(calls++ === 0 ? "2026-10-09T10:00:00Z" : "2026-10-09T10:00:01Z");
    const res = await approveProposal(deps, { proposalId: "p1", user: RM });
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect(store.status).toBe("DRAFT");
  });

  it("refuses an RM who is not assigned and allows an Admin", async () => {
    const other = setup();
    expect((await approveProposal(other.deps, { proposalId: "p1", user: { id: "rm2", role: "RM" } })).ok).toBe(false);
    const admin = setup();
    expect((await approveProposal(admin.deps, { proposalId: "p1", user: ADMIN })).ok).toBe(true);
  });

  it("refuses a Manager (view-only)", async () => {
    const { sent, deps } = setup();
    expect((await approveProposal(deps, { proposalId: "p1", user: { id: "m1", role: "MANAGER" } })).ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("stores the edited text that was actually sent", async () => {
    const { store, sent, deps } = setup();
    await approveProposal(deps, { proposalId: "p1", user: RM, editedBody: "  Hi Riya, shall we finish KYC today?  " });
    expect(sent[0].body).toBe("Hi Riya, shall we finish KYC today?");
    expect(store.body).toBe("Hi Riya, shall we finish KYC today?");
  });

  it("two concurrent approvals (RM and Admin) send exactly one message", async () => {
    const { sent, store, deps } = setup();
    const [a, b] = await Promise.all([
      approveProposal(deps, { proposalId: "p1", user: RM }),
      approveProposal(deps, { proposalId: "p1", user: ADMIN }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(store.status).toBe("SENT");
  });

  it("a failing SENT write after a successful send does not throw, returns ok, and blocks any re-send", async () => {
    const { store, sent, log, deps } = setup();
    log.failTo = "SENT";
    const res = await approveProposal(deps, { proposalId: "p1", user: RM });
    expect(res).toEqual({ ok: true, messageId: "m1" });
    expect(store.status).toBe("APPROVED");
    const again = await approveProposal(deps, { proposalId: "p1", user: RM });
    expect(again.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("a send failure releases the claim, and a retry then sends once", async () => {
    const { store, sent, deps } = setup();
    const realSend = deps.send;
    deps.send = async () => { throw new Error("WhatsApp is offline"); };
    const res = await approveProposal(deps, { proposalId: "p1", user: RM });
    expect(res).toMatchObject({ ok: false, error: "WhatsApp is offline" });
    expect(store.status).toBe("DRAFT");
    deps.send = realSend;
    expect((await approveProposal(deps, { proposalId: "p1", user: RM })).ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(store.status).toBe("SENT");
  });

  it("approve vs reject concurrently: exactly one wins and the row matches the winner", async () => {
    const { store, sent, deps } = setup();
    const [a, r] = await Promise.all([
      approveProposal(deps, { proposalId: "p1", user: RM }),
      rejectProposal(deps, { proposalId: "p1", user: RM }),
    ]);
    expect([a.ok, r.ok].filter(Boolean)).toHaveLength(1);
    if (a.ok) { expect(sent).toHaveLength(1); expect(["APPROVED", "SENT"]).toContain(store.status); }
    else { expect(sent).toHaveLength(0); expect(store.status).toBe("REJECTED"); }
  });
});

describe("rejectProposal", () => {
  it("marks a draft REJECTED", async () => {
    const { store, deps } = setup();
    expect((await rejectProposal(deps, { proposalId: "p1", user: RM })).ok).toBe(true);
    expect(store.status).toBe("REJECTED");
  });

  it("refuses an unassigned RM and an already-decided draft", async () => {
    const a = setup();
    expect((await rejectProposal(a.deps, { proposalId: "p1", user: { id: "rm2", role: "RM" } })).ok).toBe(false);
    const b = setup({ status: "SENT" });
    expect((await rejectProposal(b.deps, { proposalId: "p1", user: RM })).ok).toBe(false);
  });

  it("reports 'already decided' when the conditional update loses the race", async () => {
    const { deps } = setup();
    deps.transition = async () => false;
    expect(await rejectProposal(deps, { proposalId: "p1", user: RM })).toEqual({ ok: false, error: "This draft was already decided" });
  });
});

describe("agent scoping", () => {
  it("refuses to approve or reject a draft that belongs to another agent (e.g. an inbox suggested reply)", async () => {
    const { deps, store, sent } = setup({ agentKey: "wa_reply" });
    expect(await approveProposal(deps, { proposalId: "p1", user: RM })).toEqual({ ok: false, error: "Draft not found" });
    expect(await rejectProposal(deps, { proposalId: "p1", user: RM })).toEqual({ ok: false, error: "Draft not found" });
    expect(sent).toHaveLength(0);
    expect(store.status).toBe("DRAFT");
  });
});
