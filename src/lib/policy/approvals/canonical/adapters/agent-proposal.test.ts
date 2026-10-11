import { describe, expect, it, vi } from "vitest";

import { approveProposal, rejectProposal, type DecideDeps, type StoredProposal } from "@/lib/agents/decide";
import { canTransition } from "@/lib/agents/proposal-state";

import { createApprovalService } from "../service";
import { createAgentProposalAdapter, toCanonicalAgentProposal, type AgentRow } from "./agent-proposal";

const NOW = new Date("2026-10-09T10:00:00Z");
const RM = { id: "rm1", role: "RM" } as const;
const OTHER_RM = { id: "rm2", role: "RM" } as const;
const ADMIN = { id: "a1", role: "ADMIN" } as const;
const MANAGER = { id: "m1", role: "MANAGER" } as const;
const tick = () => new Promise((r) => setTimeout(r, 0));

type Store = StoredProposal & { decidedById?: string; blockedReason?: string; messageId?: string };

/** Two identical in-memory worlds with a real compare-and-set: one driven by the legacy function, one through the canonical service. */
function world(over: Partial<StoredProposal> = {}, sendFails = false) {
  const store: Store = { id: "p1", agentKey: "wa_nudger", clientId: "c1", assignedToId: "rm1", status: "DRAFT", body: "Hi Riya, can I help with KYC?", expiresAt: new Date("2026-10-11T10:00:00Z"), ...over };
  const sent: string[] = [];
  const legacy: DecideDeps = {
    load: async () => ({ ...store }),
    transition: async (_id, from, to, patch, opts) => {
      await tick();
      if (store.status !== from) return false;
      if (opts?.notExpiredAt && store.expiresAt.getTime() <= opts.notExpiredAt.getTime()) return false;
      if (!canTransition(from, to)) throw new Error(`illegal ${from}->${to}`);
      Object.assign(store, patch ?? {}, { status: to });
      return true;
    },
    send: async ({ user, body }) => {
      await tick();
      if (sendFails) throw new Error("WhatsApp is not connected");
      sent.push(`${user.id}:${body}`);
      return { messageId: "m1" };
    },
    now: () => NOW,
  };
  const row = (): AgentRow => ({ id: store.id, agentKey: store.agentKey, clientId: store.clientId, clientName: "Riya Shah", clientCode: "C-001", assignedToId: store.assignedToId, status: store.status, body: store.body, reason: "KYC pending 12 days", programme: "kyc", channel: "whatsapp", createdAt: new Date("2026-10-08T10:00:00Z"), expiresAt: store.expiresAt, decidedById: store.decidedById ?? null, decidedAt: null, blockedReason: store.blockedReason ?? null });
  const adapter = createAgentProposalAdapter({ legacy, loadAwaiting: async () => (store.status === "DRAFT" ? [row()] : []), loadRow: async () => row() });
  const svc = createApprovalService({ adapters: { "agent-proposal": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { store, sent, legacy, adapter, svc, row };
}
type W = ReturnType<typeof world>;
const snap = (w: W) => ({ status: w.store.status, sent: w.sent, decidedById: w.store.decidedById ?? null, blockedReason: w.store.blockedReason ?? null });

describe("agent proposal view", () => {
  it("maps every legacy status to a canonical state", () => {
    const base = world().row();
    const st = (status: AgentRow["status"], expiresAt = base.expiresAt) => toCanonicalAgentProposal({ ...base, status, expiresAt }, NOW).state;
    expect(st("DRAFT")).toBe("requested");
    expect(st("DRAFT", new Date(NOW.getTime() - 1))).toBe("expired");
    expect(st("APPROVED")).toBe("approved");
    expect(st("SENT")).toBe("executed");
    expect(st("REJECTED")).toBe("rejected");
    expect(st("EXPIRED")).toBe("expired");
    expect(st("BLOCKED")).toBe("failed");
  });

  it("carries the draft, the reason and the chain, and no contact detail", () => {
    const v = toCanonicalAgentProposal(world().row(), NOW);
    expect(v).toMatchObject({ ref: "agent-proposal:p1", kind: "agent-proposal", requestedBy: null, autonomy: "L4", correlationId: "approval:agent-proposal:p1", causationId: null, clientId: "c1", fourEyesAuthorId: null });
    expect(v.subject).toEqual({ type: "Customer message", id: "c1", label: "Riya Shah", href: "/clients/c1" });
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["draft", "reason"]));
    expect(JSON.stringify(v)).not.toMatch(/mobile|email|pan/i);
    expect(v.summary).toBe("Draft WhatsApp message to Riya Shah");
    expect(v.evidence.find((e) => e.key === "channel")?.value).toBe("WhatsApp");
    expect(v.evidence.find((e) => e.key === "programme")?.value).toBe("Kyc");
  });

  it("is visible to an Admin and to the assigned RM only (managers are view-only in the legacy path)", async () => {
    const w = world();
    expect(await w.adapter.get("p1", ADMIN, NOW)).not.toBeNull();
    expect(await w.adapter.get("p1", RM, NOW)).not.toBeNull();
    expect(await w.adapter.get("p1", OTHER_RM, NOW)).toBeNull();
    expect(await w.adapter.get("p1", MANAGER, NOW)).toBeNull();
    expect(await createAgentProposalAdapter({ legacy: w.legacy, loadAwaiting: async () => [], loadRow: async () => ({ ...w.row(), agentKey: "wa_reply" }) }).get("p1", ADMIN, NOW)).toBeNull(); // inbox replies are not approved here
  });
});

describe("agent proposal: the canonical path gives the same outcome as the legacy path", () => {
  async function both(scenario: { over?: Partial<StoredProposal>; sendFails?: boolean; user: typeof RM | typeof ADMIN | typeof MANAGER | typeof OTHER_RM; decision: "approve" | "reject"; editedBody?: string; reason?: string }) {
    const a = world(scenario.over, scenario.sendFails);
    const b = world(scenario.over, scenario.sendFails);
    const legacy = scenario.decision === "approve" ? await approveProposal(a.legacy, { proposalId: "p1", user: scenario.user, editedBody: scenario.editedBody }) : await rejectProposal(a.legacy, { proposalId: "p1", user: scenario.user });
    const canon = await b.svc.decide(scenario.user, "agent-proposal:p1", scenario.decision, { reason: scenario.decision === "reject" ? (scenario.reason ?? "not now") : undefined, params: scenario.editedBody ? { editedBody: scenario.editedBody } : {} });
    return { a, b, legacy, canon };
  }

  it("approve by the assigned RM: one message, SENT", async () => {
    const { a, b, legacy, canon } = await both({ user: RM, decision: "approve" });
    expect(legacy.ok && canon.ok).toBe(true);
    expect(snap(b)).toEqual(snap(a));
    expect(b.sent).toHaveLength(1);
    expect(canon).toMatchObject({ ok: true, state: "executed", messageId: "m1" });
  });

  it("approve by an Admin", async () => {
    const { a, b, canon } = await both({ user: ADMIN, decision: "approve" });
    expect(snap(b)).toEqual(snap(a));
    expect(canon.ok).toBe(true);
  });

  it("reject", async () => {
    const { a, b, canon } = await both({ user: RM, decision: "reject" });
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b).status).toBe("REJECTED");
    expect(canon).toMatchObject({ ok: true, state: "rejected" });
  });

  it("an edited message that breaks a rule is blocked, nothing is sent, and the row says why", async () => {
    const { a, b, legacy, canon } = await both({ user: RM, decision: "approve", editedBody: "Guaranteed returns await you" });
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "BLOCKED" });
    expect(snap(b)).toEqual(snap(a));
    expect(b.sent).toEqual([]);
    expect(snap(b).status).toBe("BLOCKED");
  });

  it("an expired draft cannot be approved: both end EXPIRED with nothing sent", async () => {
    const { a, b, canon } = await both({ user: RM, decision: "approve", over: { expiresAt: new Date(NOW.getTime() - 1000) } });
    expect(canon).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b).status).toBe("EXPIRED");
  });

  it("an RM who does not own the customer, and a manager, get nothing done in either path", async () => {
    for (const user of [OTHER_RM, MANAGER]) {
      const { a, b, legacy, canon } = await both({ user, decision: "approve" });
      expect(legacy.ok || canon.ok).toBe(false);
      expect(snap(b)).toEqual(snap(a));
      expect(b.sent).toEqual([]);
    }
  });

  it("a send failure releases the claim in both paths, and no message exists", async () => {
    const { a, b, canon } = await both({ user: RM, decision: "approve", sendFails: true });
    expect(canon.ok).toBe(false);
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b).status).toBe("DRAFT");
    expect(b.sent).toEqual([]);
  });

  it("an already-decided draft stays as it is", async () => {
    const { a, b, canon } = await both({ user: RM, decision: "approve", over: { status: "REJECTED" } });
    expect(canon).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(snap(b)).toEqual(snap(a));
  });

  it("double-approve race through the canonical service (RM and Admin together): exactly one message", async () => {
    const w = world();
    const [r1, r2] = await Promise.all([w.svc.decide(RM, "agent-proposal:p1", "approve", {}), w.svc.decide(ADMIN, "agent-proposal:p1", "approve", {})]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect(w.sent).toHaveLength(1);
    expect(w.store.status).toBe("SENT");
  });

  it("approve versus reject at once: one wins and the row matches the winner", async () => {
    const w = world();
    const [r1, r2] = await Promise.all([w.svc.decide(RM, "agent-proposal:p1", "approve", {}), w.svc.decide(ADMIN, "agent-proposal:p1", "reject", { reason: "no" })]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect(["SENT", "REJECTED"]).toContain(w.store.status);
    expect(w.sent).toHaveLength(w.store.status === "SENT" ? 1 : 0);
  });

  it("the send is only ever made by the legacy path, with its compare-and-set claim first (the adapter has no send of its own)", async () => {
    const w = world();
    const order: string[] = [];
    const origTransition = w.legacy.transition;
    const origSend = w.legacy.send;
    w.legacy.transition = async (...args) => { order.push(`transition:${args[1]}->${args[2]}${args[4]?.notExpiredAt ? ":atomic-expiry" : ""}`); return origTransition(...args); };
    w.legacy.send = async (i) => { order.push("send"); return origSend(i); };
    await w.svc.decide(RM, "agent-proposal:p1", "approve", {});
    expect(order).toEqual(["transition:DRAFT->APPROVED:atomic-expiry", "send", "transition:APPROVED->SENT"]);
  });
});

describe("agent proposal: listing for the inbox", () => {
  it("awaiting returns the legacy loader's rows as requested items", async () => {
    const w = world();
    const loadAwaiting = vi.fn(async () => [w.row()]);
    const adapter = createAgentProposalAdapter({ legacy: w.legacy, loadAwaiting, loadRow: async () => w.row() });
    const rows = await adapter.listAwaiting(RM, NOW, 50);
    expect(rows.map((r) => r.state)).toEqual(["requested"]);
    expect(loadAwaiting).toHaveBeenCalledWith(RM, NOW, 50);
    expect(await adapter.listRequestedBy(RM, NOW, 50)).toEqual([]); // nobody asks for an agent draft by hand
  });
});
