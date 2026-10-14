/**
 * Real-database proof that the canonical approval service gives the same outcome as each legacy path, on the real adapters and the
 * real stores: self-approval refused, expiry, the double-approve race, the send claim in agents/decide.ts, scoping by role, and
 * write-through on and off. Needs a throwaway local Postgres, so it is skipped unless APPROVALS_DB_TEST=1 (and refuses any non-local database):
 *   APPROVALS_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/policy/approvals/canonical/equivalence.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));
const sent: { clientId: string; body: string; userId: string }[] = [];
vi.mock("@/lib/whatsapp/send", () => ({ queueWhatsAppReply: async (i: { user: { id: string }; clientId: string; body: string }) => { sent.push({ clientId: i.clientId, body: i.body, userId: i.user.id }); return { id: `msg-${sent.length}` }; } }));

// Approval now sends through the business-number template path (consent, programme and approved-template gates are covered in business-nudge tests); here the send itself is a stub so the approval equivalence is what is compared.
vi.mock("@/lib/agents/business-nudge", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/business-nudge")>()),
  sendApprovedNudge: async (i: { clientId: string; senderUserId: string }) => { sent.push({ clientId: i.clientId, body: "template", userId: i.senderUserId }); return { messageId: `msg-${sent.length}`, templateName: "stub" }; },
}));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.APPROVALS_DB_TEST === "1" && local;
const P = "w1b-";
const DAY = 86_400_000;
const user = (id: string, role: string) => ({ id: `${P}${id}`, role: role as never });

describe.skipIf(!enabled)("canonical approvals against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let svc: ReturnType<typeof import("./wiring").approvalService>;
  let stageId = "";
  const rm1 = user("rm1", "RM"), rm2 = user("rm2", "RM"), mgr = user("mgr", "MANAGER"), adm1 = user("adm1", "ADMIN"), adm2 = user("adm2", "ADMIN");
  const fin1 = user("fin1", "FINANCE"), fin2 = user("fin2", "FINANCE"), mk1 = user("mk1", "MARKETING"), mk2 = user("mk2", "MARKETING");
  const everyone = [rm1, rm2, mgr, adm1, adm2, fin1, fin2, mk1, mk2];
  let n = 0;
  const uid = () => `${P}${Date.now().toString(36)}${++n}`;

  async function cleanup() {
    const ids = (await db.client.findMany({ where: { clientCode: { startsWith: "W1B-" } }, select: { id: true } })).map((c) => c.id);
    await db.agentProposal.deleteMany({ where: { clientId: { in: ids } } });
    await db.mergeSuggestion.deleteMany({ where: { OR: [{ clientAId: { in: ids } }, { clientBId: { in: ids } }] } });
    const refs = (await db.referrer.findMany({ where: { clientId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await db.rewardStatement.deleteMany({ where: { referrerId: { in: refs } } });
    await db.rewardLedgerEntry.deleteMany({ where: { referrerId: { in: refs } } });
    await db.referrer.deleteMany({ where: { id: { in: refs } } });
    await db.stageHistory.deleteMany({ where: { clientId: { in: ids } } });
    await db.activity.deleteMany({ where: { clientId: { in: ids } } });
    await db.erasureRequest.deleteMany({ where: { requestedById: { startsWith: P } } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
    await db.socialPost.deleteMany({ where: { createdById: { startsWith: P } } });
    await db.approvalRequest.deleteMany({ where: { requestedById: { startsWith: P } } });
    await db.payoutRun.deleteMany({ where: { createdById: { startsWith: P } } });
    await db.aiPilotSignoff.deleteMany({ where: { acknowledgedById: { startsWith: P } } });
    await db.aiPilotUser.deleteMany({ where: { userId: { startsWith: P } } });
  }
  const client = (code: string, assignedToId: string | null) => db.client.create({ data: { clientCode: `W1B-${code}-${uid()}`.slice(0, 40), name: `Test ${code}`, mobile: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, currentStageId: stageId, assignedToId } });

  beforeAll(async () => {
    process.env.REFERRAL_PROGRAM_ENABLED = "1";
    process.env.NEXT_PUBLIC_MERGE_REVIEW = "1";
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    svc = (await import("./wiring")).approvalService();
    stageId = ((await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "W1B stage", sequence: 9202, slaHours: 24 } }))).id;
    await cleanup();
    for (const u of everyone) await db.user.upsert({ where: { id: u.id }, update: { role: u.role }, create: { id: u.id, name: `W1B ${u.id}`, email: `${u.id}@example.test`, passwordHash: "x", role: u.role } });
  });
  beforeEach(() => { sent.length = 0; delete process.env.APPROVALS_WT_AGENT_PROPOSAL; });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.auditLog.findFirst(); // audit rows are append-only and stay
      await db.user.deleteMany({ where: { id: { in: everyone.map((u) => u.id) }, AND: [{ auditLogs: { none: {} } }] } }).catch(() => undefined);
      await db.$disconnect();
    }
  });

  // ---- agent proposals -------------------------------------------------------------------------------------------------
  const proposal = async (clientId: string, over: Record<string, unknown> = {}) =>
    db.agentProposal.create({ data: { agentKey: "wa_nudger", clientId, body: "Hi, shall we finish your KYC this week?", originalBody: "Hi, shall we finish your KYC this week?", reason: "KYC pending", provider: "fake", model: "fake", expiresAt: new Date(Date.now() + 2 * DAY), ...over } });

  it("agent proposal: approve through the inbox and through the legacy path give the same row and one message each", async () => {
    const { approveProposal } = await import("@/lib/agents/decide");
    const { decideDeps } = await import("@/lib/agents/wiring");
    const c1 = await client("A1", rm1.id), c2 = await client("A2", rm1.id);
    const legacyP = await proposal(c1.id), canonP = await proposal(c2.id);
    const legacy = await approveProposal(decideDeps(), { proposalId: legacyP.id, user: rm1 });
    const canon = await svc.decide(rm1, `agent-proposal:${canonP.id}`, "approve", {});
    expect(legacy.ok && canon.ok).toBe(true);
    const [a, b] = await Promise.all([db.agentProposal.findUnique({ where: { id: legacyP.id } }), db.agentProposal.findUnique({ where: { id: canonP.id } })]);
    expect({ status: b!.status, decidedById: b!.decidedById, hasMessage: !!b!.messageId }).toEqual({ status: a!.status, decidedById: a!.decidedById, hasMessage: !!a!.messageId });
    expect(b!.status).toBe("SENT");
    expect(sent).toHaveLength(2);
    expect(canon).toMatchObject({ ok: true, state: "executed" });
  });

  it("agent proposal: expiry ends EXPIRED in both paths and sends nothing", async () => {
    const { approveProposal } = await import("@/lib/agents/decide");
    const { decideDeps } = await import("@/lib/agents/wiring");
    const c1 = await client("E1", rm1.id), c2 = await client("E2", rm1.id);
    const past = { expiresAt: new Date(Date.now() - 1000) };
    const lp = await proposal(c1.id, past), cp = await proposal(c2.id, past);
    expect((await approveProposal(decideDeps(), { proposalId: lp.id, user: rm1 })).ok).toBe(false);
    expect(await svc.decide(rm1, `agent-proposal:${cp.id}`, "approve", {})).toMatchObject({ ok: false, code: "EXPIRED" });
    expect((await db.agentProposal.findUnique({ where: { id: cp.id } }))!.status).toBe((await db.agentProposal.findUnique({ where: { id: lp.id } }))!.status);
    expect((await db.agentProposal.findUnique({ where: { id: cp.id } }))!.status).toBe("EXPIRED");
    expect(sent).toHaveLength(0);
  });

  it("agent proposal: the double-approve race sends exactly one message (the compare-and-set claim is intact)", async () => {
    const c = await client("R1", rm1.id);
    const p = await proposal(c.id);
    const results = await Promise.all([svc.decide(rm1, `agent-proposal:${p.id}`, "approve", {}), svc.decide(adm1, `agent-proposal:${p.id}`, "approve", {}), svc.decide(rm1, `agent-proposal:${p.id}`, "approve", {})]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await db.agentProposal.findUnique({ where: { id: p.id } }))!.status).toBe("SENT");
  });

  it("agent proposal: an RM sees only drafts for their own customers; a manager, finance and marketing see none", async () => {
    const mine = await client("S1", rm1.id), theirs = await client("S2", rm2.id);
    const p1 = await proposal(mine.id), p2 = await proposal(theirs.id);
    const ids = async (u: typeof rm1) => (await svc.listFor(u, { tab: "awaiting", kind: "agent-proposal" })).items.map((i) => i.id);
    expect(await ids(rm1)).toContain(p1.id);
    expect(await ids(rm1)).not.toContain(p2.id);
    expect(await ids(rm2)).toContain(p2.id);
    expect(await ids(adm1)).toEqual(expect.arrayContaining([p1.id, p2.id]));
    for (const u of [mgr, fin1, mk1]) expect(await ids(u), u.role).toEqual([]);
    expect(await svc.decide(rm1, `agent-proposal:${p2.id}`, "approve", {})).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await db.agentProposal.findUnique({ where: { id: p2.id } }))!.status).toBe("DRAFT");
  });

  it("write-through: off leaves no canonical record; on leaves exactly one, with reason, approver and chain; the audit row is written either way", async () => {
    const c1 = await client("W1", rm1.id), c2 = await client("W2", rm1.id);
    const off = await proposal(c1.id), on = await proposal(c2.id);
    await svc.decide(rm1, `agent-proposal:${off.id}`, "reject", { reason: "Wrong tone" });
    expect(await db.approvalRequest.count({ where: { idempotencyKey: { startsWith: `mirror:agent-proposal:${off.id}` } } })).toBe(0);
    process.env.APPROVALS_WT_AGENT_PROPOSAL = "1";
    await svc.decide(rm1, `agent-proposal:${on.id}`, "reject", { reason: "Too pushy" });
    const rows = await db.approvalRequest.findMany({ where: { idempotencyKey: { startsWith: `mirror:agent-proposal:${on.id}` } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "REJECTED", decidedById: rm1.id, decisionNote: "Too pushy", correlationId: `approval:agent-proposal:${on.id}`, autonomyLevel: "L4", actionType: "AGENT_PROPOSAL" });
    const { decideApproval } = await import("../service");
    await expect(decideApproval(rows[0].id, "APPROVED", undefined, { id: adm1.id, role: "ADMIN" })).rejects.toThrow(/already/i);
    for (const id of [off.id, on.id]) expect(await db.auditLog.count({ where: { entity: "Approval", entityId: `agent-proposal:${id}`, action: "approval_rejected" } })).toBe(1);
    // the legacy row is untouched by the mirror
    expect((await db.agentProposal.findUnique({ where: { id: on.id } }))!.status).toBe("REJECTED");
  });

  // ---- social posts -----------------------------------------------------------------------------------------------------
  const GOOD = async () => { const { STANDARD_RISK_LINE } = await import("@/lib/marketing/social/compliance"); return `Demat accounts explained.\n\n${STANDARD_RISK_LINE}\nSEBI Registration No: INZ000123456`; };
  async function submittedPost(author: typeof mk1) {
    const { socialService } = await import("@/lib/marketing/social/store");
    const s = socialService();
    const made = await s.createDraft({ channel: "linkedin", title: "Demat", body: await GOOD(), actor: author, source: "STAFF" });
    if (!made.ok) throw new Error(made.error);
    const sub = await s.transition(made.post.id, "submit", { actor: author });
    if (!sub.ok) throw new Error(sub.error);
    return made.post.id;
  }

  it("social post: four-eyes and approval give the same row through both paths; RM sees nothing, marketing sees the queue", async () => {
    const { socialService } = await import("@/lib/marketing/social/store");
    const legacyId = await submittedPost(mk1), canonId = await submittedPost(mk1);
    const legacy = await socialService().transition(legacyId, "approve", { actor: mk2, confirmed: true });
    expect(await svc.decide(mk1, `social-post:${canonId}`, "approve", { params: { confirmed: true } })).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect((await db.socialPost.findUnique({ where: { id: canonId } }))!.status).toBe("NEEDS_REVIEW");
    const canon = await svc.decide(mk2, `social-post:${canonId}`, "approve", { params: { confirmed: true } });
    expect(legacy.ok && canon.ok).toBe(true);
    const [a, b] = await Promise.all([db.socialPost.findUnique({ where: { id: legacyId } }), db.socialPost.findUnique({ where: { id: canonId } })]);
    expect({ status: b!.status, approvedById: b!.approvedById }).toEqual({ status: a!.status, approvedById: a!.approvedById });
    const waiting = await submittedPost(mk1);
    expect((await svc.listFor(mk2, { tab: "awaiting" })).items.map((i) => i.id)).toContain(waiting);
    expect((await svc.listFor(mk1, { tab: "awaiting" })).items.map((i) => i.id)).not.toContain(waiting); // their own
    expect((await svc.listFor(mk1, { tab: "mine" })).items.map((i) => i.id)).toContain(waiting);
    for (const u of [rm1, mgr, fin1]) expect((await svc.listFor(u, { tab: "awaiting" })).items.filter((i) => i.kind === "social-post"), u.role).toEqual([]);
    expect((await svc.listFor(mk2, { tab: "awaiting" })).items.every((i) => ["social-post"].includes(i.kind))).toBe(true);
    const race = await submittedPost(mk1);
    const rs = await Promise.all([svc.decide(adm1, `social-post:${race}`, "approve", { params: { confirmed: true } }), svc.decide(mk2, `social-post:${race}`, "approve", { params: { confirmed: true } })]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.socialPostEvent.count({ where: { postId: race, action: "approve" } })).toBe(1);
    const rej = await submittedPost(mk1);
    expect(await svc.decide(mk2, `social-post:${rej}`, "reject", { reason: "Add the risk line" })).toMatchObject({ ok: true, state: "rejected" });
    expect(await db.socialPost.findUnique({ where: { id: rej } })).toMatchObject({ status: "DRAFT", reviewNote: "Add the risk line" });
  });

  // ---- referral statements ---------------------------------------------------------------------------------------------
  async function preparedStatement(period: string) {
    const { prismaReferralStore: store } = await import("@/lib/referrals/prisma-store");
    const { prepareStatement } = await import("@/lib/referrals/statements");
    const owner = await client("RF", null);
    const ref = await db.referrer.create({ data: { clientId: owner.id, createdById: adm1.id } });
    await store.appendEntries([{ idempotencyKey: `${ref.id}:a`, kind: "ACCRUED", referrerId: ref.id, referralId: null, eventType: "KYC_COMPLETE", ruleId: null, refEntryId: null, statementId: null, amountPaise: 10000, periodMonth: period, flags: [], note: null, actorId: null }]);
    const prep = await prepareStatement({ store, actor: fin1, referrerId: ref.id, period });
    if (!prep.ok) throw new Error(prep.error);
    return { id: prep.statementId, referrerId: ref.id };
  }

  it("referral statement: same approval, same ledger rows, four-eyes, one winner in a race; only Admin and Finance see it", async () => {
    const { prismaReferralStore: store } = await import("@/lib/referrals/prisma-store");
    const { approveStatement } = await import("@/lib/referrals/statements");
    const a = await preparedStatement("2027-01"), b = await preparedStatement("2027-02"), c = await preparedStatement("2027-03");
    expect(await svc.decide(fin1, `referral-statement:${b.id}`, "approve", {})).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect((await db.rewardStatement.findUnique({ where: { id: b.id } }))!.status).toBe("PREPARED");
    const legacy = await approveStatement({ store, actor: adm1, statementId: a.id });
    const canon = await svc.decide(adm1, `referral-statement:${b.id}`, "approve", {});
    expect(legacy.ok && canon.ok).toBe(true);
    const [sa, sb] = await Promise.all([db.rewardStatement.findUnique({ where: { id: a.id } }), db.rewardStatement.findUnique({ where: { id: b.id } })]);
    expect({ status: sb!.status, approvedById: sb!.approvedById }).toEqual({ status: sa!.status, approvedById: sa!.approvedById });
    const [la, lb] = await Promise.all([db.rewardLedgerEntry.count({ where: { referrerId: a.referrerId, kind: "APPROVED" } }), db.rewardLedgerEntry.count({ where: { referrerId: b.referrerId, kind: "APPROVED" } })]);
    expect(lb).toBe(la);
    const rs = await Promise.all([svc.decide(adm1, `referral-statement:${c.id}`, "approve", {}), svc.decide(fin2, `referral-statement:${c.id}`, "approve", {})]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.rewardLedgerEntry.count({ where: { referrerId: c.referrerId, kind: "APPROVED" } })).toBe(1);
    const d = await preparedStatement("2027-04");
    expect((await svc.listFor(adm1, { tab: "awaiting" })).items.map((i) => i.id)).toContain(d.id);
    expect((await svc.listFor(fin2, { tab: "awaiting" })).items.map((i) => i.id)).toContain(d.id);
    expect((await svc.listFor(fin1, { tab: "awaiting" })).items.map((i) => i.id)).not.toContain(d.id); // they prepared it
    for (const u of [rm1, mgr, mk1]) expect((await svc.listFor(u, { tab: "awaiting" })).items.filter((i) => i.kind === "referral-statement"), u.role).toEqual([]);
  });

  // ---- merge suggestions -----------------------------------------------------------------------------------------------
  it("merge suggestion: dismiss through both paths; an RM sees only pairs that include their own customer, and never decides a restricted pair", async () => {
    const { decideDismiss } = await import("@/lib/identity/merge-review/decide");
    const { decideDeps } = await import("@/lib/identity/merge-review/wiring");
    const mk = async (ownerA: string, ownerB: string) => { const a = await client("MA", ownerA), b = await client("MB", ownerB); return db.mergeSuggestion.create({ data: { clientAId: a.id, clientBId: b.id, score: 0.9, reasons: ["same_mobile"] } }); };
    const s1 = await mk(rm1.id, rm1.id), s2 = await mk(rm1.id, rm1.id), restricted = await mk(rm1.id, rm2.id);
    expect((await decideDismiss(decideDeps(), rm1, { suggestionId: s1.id, reason: "Different people" })).ok).toBe(true);
    expect(await svc.decide(rm1, `merge-suggestion:${s2.id}`, "reject", { reason: "Different people" })).toMatchObject({ ok: true, state: "rejected" });
    const [a, b] = await Promise.all([db.mergeSuggestion.findUnique({ where: { id: s1.id } }), db.mergeSuggestion.findUnique({ where: { id: s2.id } })]);
    expect(b!.status).toBe(a!.status);
    expect(b!.status).toBe("DISMISSED");
    expect(await svc.decide(rm1, `merge-suggestion:${restricted.id}`, "reject", { reason: "x" })).toMatchObject({ ok: false });
    expect((await db.mergeSuggestion.findUnique({ where: { id: restricted.id } }))!.status).toBe("OPEN");
    expect((await svc.listFor(rm1, { tab: "awaiting", kind: "merge-suggestion" })).items.map((i) => i.id)).not.toContain(restricted.id);
    expect((await svc.listFor(mgr, { tab: "awaiting", kind: "merge-suggestion" })).items.map((i) => i.id)).toContain(restricted.id);
    const open = await mk(rm1.id, rm1.id);
    expect(await svc.decide(mgr, `merge-suggestion:${open.id}`, "approve", { params: { confirmed: true, survivorId: "x" } })).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect((await db.mergeSuggestion.findUnique({ where: { id: open.id } }))!.status).toBe("OPEN"); // a merge is never done from the list
  });

  // ---- AI pilot sign-off -----------------------------------------------------------------------------------------------
  it("AI pilot sign-off: pending only once someone is on the list; an Admin ticks; it is recorded once", async () => {
    const { PILOT_STATEMENT_VERSION } = await import("@/lib/agents/pilot");
    const ref = `ai-pilot-signoff:${PILOT_STATEMENT_VERSION}`;
    await db.aiPilotSignoff.deleteMany({});
    await db.aiPilotUser.deleteMany({});
    expect((await svc.listFor(adm1, { tab: "awaiting", kind: "ai-pilot-signoff" })).items).toEqual([]);
    await db.aiPilotUser.create({ data: { userId: rm1.id, addedById: adm1.id } });
    expect((await svc.listFor(adm1, { tab: "awaiting", kind: "ai-pilot-signoff" })).items).toHaveLength(1);
    expect((await svc.listFor(mgr, { tab: "awaiting" })).items.filter((i) => i.kind === "ai-pilot-signoff")).toEqual([]);
    expect(await svc.decide(adm1, ref, "approve", {})).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    // Four-eyes: the compliance signature, then a DIFFERENT Admin; the same person twice is refused.
    expect(await svc.decide(adm1, ref, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: true });
    expect(await db.aiPilotSignoff.count({ where: { revokedAt: null } })).toBe(1);
    expect(await svc.decide(adm1, ref, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(await db.aiPilotSignoff.count({ where: { revokedAt: null } })).toBe(1);
    expect((await svc.listFor(adm2, { tab: "awaiting", kind: "ai-pilot-signoff" })).items).toHaveLength(1); // still awaiting a different Admin
    expect(await svc.decide(adm2, ref, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: true });
    expect(await db.aiPilotSignoff.count({ where: { revokedAt: null } })).toBe(2);
    expect(await db.auditLog.count({ where: { entity: "AiPilot", action: "pilot_signoff_recorded", userId: adm1.id } })).toBeGreaterThanOrEqual(1);
    expect(await svc.decide(adm1, ref, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    await db.aiPilotSignoff.deleteMany({});
    await db.aiPilotUser.deleteMany({});
  });

  // ---- native ApprovalRequest kinds ------------------------------------------------------------------------------------
  let period = 0;
  async function payoutRun(requester: typeof fin1, over: { expiresAt?: Date } = {}) {
    const { requestApproval } = await import("../service");
    const start = new Date(Date.UTC(2031, 0, 1 + 40 * ++period)), end = new Date(start.getTime() + 27 * DAY);
    const run = await db.payoutRun.create({ data: { periodStart: start, periodEnd: end, status: "PENDING_APPROVAL", createdById: requester.id } });
    const req = await requestApproval("PAYOUT_ADJUSTMENT", { entity: "PayoutRun", entityId: run.id, payload: { payoutRunId: run.id }, reason: "Payout run submitted for approval", ...over }, requester);
    return { run, req };
  }

  it("payout run: the inbox and the generic service approve the same way; self-approval, expiry and the race behave identically", async () => {
    const { decideApproval } = await import("../service");
    const a = await payoutRun(fin1), b = await payoutRun(fin1);
    await decideApproval(a.req.id, "APPROVED", "ok", adm1);
    const canon = await svc.decide(adm1, `payout-run:${b.req.id}`, "approve", { reason: "ok" });
    expect(canon).toMatchObject({ ok: true, state: "executed" });
    const [ra, rb, qa, qb] = await Promise.all([db.payoutRun.findUnique({ where: { id: a.run.id } }), db.payoutRun.findUnique({ where: { id: b.run.id } }), db.approvalRequest.findUnique({ where: { id: a.req.id } }), db.approvalRequest.findUnique({ where: { id: b.req.id } })]);
    expect({ run: rb!.status, approvedBy: rb!.approvedById, req: qb!.status, applied: !!qb!.appliedAt, note: qb!.decisionNote }).toEqual({ run: ra!.status, approvedBy: ra!.approvedById, req: qa!.status, applied: !!qa!.appliedAt, note: qa!.decisionNote });
    expect(rb!.status).toBe("APPROVED");

    const own = await payoutRun(adm1);
    expect(await svc.decide(adm1, `payout-run:${own.req.id}`, "approve", {})).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    await expect(decideApproval(own.req.id, "APPROVED", undefined, adm1)).rejects.toThrow(/Maker cannot/);
    expect((await db.payoutRun.findUnique({ where: { id: own.run.id } }))!.status).toBe("PENDING_APPROVAL");

    const old = await payoutRun(fin1, { expiresAt: new Date(Date.now() - 1000) });
    expect(await svc.decide(adm1, `payout-run:${old.req.id}`, "approve", {})).toMatchObject({ ok: false, code: "EXPIRED" });
    expect((await db.approvalRequest.findUnique({ where: { id: old.req.id } }))!.status).toBe("EXPIRED");
    expect((await db.payoutRun.findUnique({ where: { id: old.run.id } }))!.status).toBe("PENDING_APPROVAL");
    // the generic service itself refuses an expired request (the clock decided first), whoever asks
    const old2 = await payoutRun(fin1, { expiresAt: new Date(Date.now() - 1000) });
    await expect(decideApproval(old2.req.id, "APPROVED", undefined, adm1)).rejects.toThrow(/expired/i);
    expect((await db.approvalRequest.findUnique({ where: { id: old2.req.id } }))!.status).toBe("EXPIRED");
    expect((await db.payoutRun.findUnique({ where: { id: old2.run.id } }))!.status).toBe("PENDING_APPROVAL");

    const race = await payoutRun(fin1);
    const rs = await Promise.all([svc.decide(adm1, `payout-run:${race.req.id}`, "approve", {}), svc.decide(adm2, `payout-run:${race.req.id}`, "approve", {})]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect((await db.payoutRun.findUnique({ where: { id: race.run.id } }))!.status).toBe("APPROVED");

    const toReject = await payoutRun(fin1);
    expect(await svc.decide(adm1, `payout-run:${toReject.req.id}`, "reject", { reason: "Wrong period" })).toMatchObject({ ok: true, state: "rejected" });
    expect(await db.approvalRequest.findUnique({ where: { id: toReject.req.id } })).toMatchObject({ status: "REJECTED", decisionNote: "Wrong period", decidedById: adm1.id });
    expect((await db.payoutRun.findUnique({ where: { id: toReject.run.id } }))!.status).toBe("PENDING_APPROVAL");
  });

  it("payout run: Admin sees it awaiting; Finance sees their own under requests and cannot decide; an RM sees nothing", async () => {
    const q = await payoutRun(fin1);
    expect((await svc.listFor(adm1, { tab: "awaiting" })).items.map((i) => i.id)).toContain(q.req.id);
    expect((await svc.listFor(fin2, { tab: "awaiting" })).items.filter((i) => i.kind === "payout-run")).toEqual([]);
    expect((await svc.listFor(fin1, { tab: "mine" })).items.map((i) => i.id)).toContain(q.req.id);
    expect((await svc.listFor(fin2, { tab: "mine" })).items.map((i) => i.id)).not.toContain(q.req.id);
    expect(await svc.decide(fin2, `payout-run:${q.req.id}`, "approve", {})).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await svc.decide(rm1, `payout-run:${q.req.id}`, "approve", {})).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const item = (await svc.listFor(adm1, { tab: "awaiting", kind: "payout-run" })).items.find((i) => i.id === q.req.id)!;
    expect(item.evidence.find((e) => e.key === "period")).toBeTruthy();
    expect(item.correlationId).toBe(`approval:payout-run:${q.req.id}`);
  });

  it("erasure request: approving only marks it approved; the customer is not deleted (as before)", async () => {
    const { requestApproval } = await import("../service");
    const c = await client("ER", rm1.id);
    const er = await db.erasureRequest.create({ data: { subjectType: "Client", subjectId: c.id, requestedById: fin1.id, notes: "Customer asked in writing" } });
    const req = await requestApproval("ERASURE_REQUEST", { entity: "ErasureRequest", entityId: er.id, payload: { erasureRequestId: er.id }, reason: "Customer asked in writing" }, fin1);
    await db.erasureRequest.update({ where: { id: er.id }, data: { approvalRequestId: req.id } });
    expect(await svc.decide(fin1, `erasure-request:${req.id}`, "approve", {})).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await svc.decide(adm1, `erasure-request:${req.id}`, "approve", {})).toMatchObject({ ok: true });
    expect((await db.erasureRequest.findUnique({ where: { id: er.id } }))!.status).toBe("APPROVED");
    expect(await db.client.count({ where: { id: c.id } })).toBe(1);
  });

  it("every decision through the service leaves an Approval audit row naming the person, the kind and the chain", async () => {
    const rows = await db.auditLog.findMany({ where: { entity: "Approval", userId: { startsWith: P } }, take: 50 });
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(["approval_approved", "approval_rejected"]).toContain(r.action);
      expect(r.newValue).toMatchObject({ via: "approvals-inbox", correlationId: expect.stringContaining("approval:") });
    }
  });
});
