/**
 * Real-database checks of the Action Ledger: four full chains read from real rows (complaint resolved then a review task; an AI draft approved then sent; a decision
 * suppressed; an ad recommendation applied), the inferred-link labelling, role scoping end to end (RM own customers, MANAGER their team, ADMIN all, MARKETING aggregated
 * and pseudonymised only), the statement count and the indexes. Skipped unless LEDGER_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own:
 *   LEDGER_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wt_ledger_main npx vitest run src/lib/ledger/ledger.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(fn: T) => fn }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.LEDGER_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe.skipIf(!enabled)("action ledger (real database)", { timeout: 120_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let ledger: typeof import("./read");
  let flowCorrelationId: (clientId: string) => string;
  const now = new Date("2027-05-20T06:00:00Z");
  const t = (ms: number) => new Date(now.getTime() - ms);
  const ids: Record<string, string> = {};
  const clients: Record<string, string> = {};
  const view = (key: string, role: string) => ({ id: ids[key], role });
  const CORR_AD = "9a3c1f00-0000-4000-8000-0000000000bb";
  const RUN_CORR = "7f1d0b0a-2222-4222-8333-444455556677";

  beforeAll(async () => {
    process.env.AUTH_SECRET ||= "ledger-db-test-secret";
    db = (await import("@/lib/db/prisma")).basePrisma;
    ledger = await import("./read");
    flowCorrelationId = (await import("@/lib/events/envelope")).flowCorrelationId;
    const mk = (key: string, role: "ADMIN" | "MANAGER" | "RM" | "MARKETING", managerId?: string) =>
      db.user.upsert({ where: { email: `led-${key}@example.test` }, update: { role, managerId: managerId ?? null }, create: { email: `led-${key}@example.test`, name: `Led ${key}`, passwordHash: "x", role, managerId } });
    ids.admin = (await mk("admin", "ADMIN")).id;
    ids.mgr = (await mk("mgr", "MANAGER")).id;
    ids.rm1 = (await mk("rm1", "RM", ids.mgr)).id;
    ids.rm2 = (await mk("rm2", "RM")).id;
    ids.mkt = (await mk("mkt", "MARKETING")).id;
    const stage = await db.stage.upsert({ where: { name: "Led test stage" }, update: {}, create: { name: "Led test stage", sequence: 9200, slaHours: 24 } });
    const mkClient = async (key: string, rm: string) => {
      const c = await db.client.create({ data: { clientCode: `LED-${key}`, name: `Ledger Customer ${key}`, mobile: `+9198000${key.length}0001`, currentStageId: stage.id, assignedToId: rm } });
      clients[key] = c.id;
      return c;
    };
    await mkClient("A", ids.rm1);
    await mkClient("B", ids.rm2);
    const A = clients.A;

    // Chain 1: complaint raised, resolved two days later; a review task an hour after (nothing names the complaint).
    const insight = await db.conversationInsight.create({ data: { clientId: A, kind: "COMPLAINT", text: "RAW COMPLAINT WORDS", severity: "high", sourceType: "NOTE", sourceRef: "n1", dedupeKey: "led-i1", occurredAt: t(5 * DAY) } });
    const complaint = await db.complaint.create({ data: { clientId: A, title: "Delayed statement", severity: "HIGH", status: "RESOLVED", ownerId: ids.rm1, sourceType: "INSIGHT", insightId: insight.id, openedAt: t(5 * DAY), slaDueAt: t(3 * DAY), resolvedAt: t(3 * DAY), resolutionCode: "explained" } });
    await db.complaintEvent.createMany({ data: [{ complaintId: complaint.id, type: "opened", at: t(5 * DAY) }, { complaintId: complaint.id, type: "resolved", actorId: ids.rm1, at: t(3 * DAY) }] });
    await db.task.create({ data: { clientId: A, assignedToId: ids.rm1, title: "Schedule customer review call", dueAt: t(-2 * DAY), category: "MEETING", source: "manual", createdAt: new Date(t(3 * DAY).getTime() + HOUR) } });
    await db.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-0000000000c1", eventType: "complaint.raised", occurredAt: t(5 * DAY), actorType: "system", clientId: A, source: "crm.web", correlationId: flowCorrelationId(A), dataClass: "PERSONAL", dedupeKey: "crm.web:led-i1:complaint.raised", metadata: { ref: { table: "ConversationInsight", id: insight.id }, severity: "HIGH", via: "conversation" } } });

    // Chain 2: engine recommends, nudger drafts (two runs), RM approves, message sent, customer replies.
    const dec = await db.decisionRecord.create({ data: decisionData(A, "ledger-d1", t(2 * DAY), { result: "RECOMMEND", status: "ACCEPTED" }) });
    ids.dec1 = dec.id;
    await db.decisionFeedback.create({ data: { decisionId: dec.id, userId: ids.rm1, kind: "accept", createdAt: new Date(t(2 * DAY).getTime() + 10 * MIN) } });
    await db.agentRun.createMany({ data: [run("nudger.draft", A, new Date(t(2 * DAY).getTime() + 3 * MIN)), run("compliance.judge", A, new Date(t(2 * DAY).getTime() + 3.2 * MIN))] });
    const msg = await db.message.create({ data: { clientId: A, channel: "whatsapp", provider: "openwa", direction: "OUTBOUND", body: "SECRET OUTBOUND BODY +919800000000", status: "DELIVERED", origin: "crm", senderUserId: ids.rm1, createdAt: new Date(t(2 * DAY).getTime() + 20 * MIN) } });
    const reply = await db.message.create({ data: { clientId: A, channel: "whatsapp", provider: "openwa", direction: "INBOUND", body: "SECRET INBOUND BODY", status: "READ", origin: "customer", createdAt: t(DAY) } });
    const prop = await db.agentProposal.create({ data: { agentKey: "wa_nudger", clientId: A, programme: "kyc", channel: "whatsapp", body: "SECRET DRAFT BODY", originalBody: "SECRET DRAFT BODY", reason: "kyc pending", status: "SENT", provider: "fake", model: "fake", decidedById: ids.rm1, decidedAt: new Date(t(2 * DAY).getTime() + 20 * MIN), messageId: msg.id, createdAt: new Date(t(2 * DAY).getTime() + 4 * MIN), expiresAt: t(-DAY), nbaDecisionId: dec.id } });
    await db.decisionOutcome.create({ data: { decisionId: dec.id, kind: "response", eventRef: reply.id, occurredAt: t(DAY), daysAfter: 1 } });
    await db.auditLog.create({ data: { userId: ids.rm1, entity: "Approval", entityId: `agent-proposal:${prop.id}`, action: "approval_approved", newValue: { kind: "agent-proposal", state: "executed", correlationId: `approval:agent-proposal:${prop.id}`, autonomy: "L4" }, timestamp: new Date(t(2 * DAY).getTime() + 20 * MIN) } });
    await db.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-0000000000c2", eventType: "whatsapp.message.sent", occurredAt: new Date(t(2 * DAY).getTime() + 20 * MIN), actorType: "user", actorId: ids.rm1, clientId: A, source: "whatsapp.worker", correlationId: flowCorrelationId(A), dataClass: "PERSONAL", dedupeKey: `whatsapp.worker:${msg.id}:whatsapp.message.sent`, metadata: { ref: { table: "Message", id: msg.id }, channel: "whatsapp" }, consentContext: { purpose: "MARKETING_COMMS", status: "GRANTED" } } });

    // Chain 3: the engine decides not to contact.
    await db.decisionRecord.create({ data: decisionData(A, "ledger-d2", t(DAY / 2), { result: "NO_ACTION", action: "no_action", suppression: [{ rule: "open_complaint", effect: "block", until: null, because: "An open complaint blocks nudges", candidateId: "stage_gate:kyc" }] }) });

    // Chain 4: the ad autopilot recommends, a marketing user approves, it is applied (no customer).
    const e1 = await db.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-0000000000d1", eventType: "campaign.autopilot.recommended", occurredAt: t(HOUR * 5), actorType: "agent", actorId: "autopilot", source: "meta.ads", correlationId: CORR_AD, dataClass: "INTERNAL", dedupeKey: "meta.ads:rec-led:recommended", metadata: { recommendationId: "rec-led" } } });
    const e2 = await db.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-0000000000d2", eventType: "campaign.autopilot.approved", occurredAt: t(HOUR * 4), actorType: "user", actorId: ids.mkt, source: "crm.web", correlationId: CORR_AD, causationId: e1.eventId, dataClass: "INTERNAL", dedupeKey: "crm.web:rec-led:approved", metadata: { recommendationId: "rec-led" } } });
    await db.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-0000000000d3", eventType: "campaign.autopilot.applied", occurredAt: t(HOUR * 4 - 5 * MIN), actorType: "system", source: "meta.ads", correlationId: CORR_AD, causationId: e2.eventId, dataClass: "INTERNAL", dedupeKey: "meta.ads:rec-led:applied", metadata: { recommendationId: "rec-led" } } });
    await db.approvalRequest.create({ data: { actionType: "AUTOPILOT_ACTION", entity: "AdCampaign", entityId: "camp-led", status: "APPROVED", payload: {}, requestedById: ids.admin, requestedAt: t(HOUR * 5 - MIN), decidedById: ids.mkt, decidedAt: t(HOUR * 4), appliedAt: t(HOUR * 4 - 5 * MIN), correlationId: CORR_AD, autonomyLevel: "L4" } });
    // customer-linked campaign facts: only ever aggregated for marketing
    await db.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-0000000000d4", eventType: "campaign.lead.attributed", occurredAt: t(HOUR), actorType: "system", clientId: A, source: "crm.web", correlationId: flowCorrelationId(A), dataClass: "PERSONAL", dedupeKey: "crm.web:led-A:campaign.lead.attributed", metadata: { campaignId: "camp-led" } } });

    // Client B (another RM's customer): one task and one message.
    await db.task.create({ data: { clientId: clients.B, assignedToId: ids.rm2, title: "Other RM private task", dueAt: t(-DAY), source: "manual", createdAt: t(DAY) } });
    await db.message.create({ data: { clientId: clients.B, channel: "whatsapp", provider: "openwa", direction: "OUTBOUND", body: "B body", status: "SENT", senderUserId: ids.rm2, createdAt: t(DAY) } });

    function decisionData(clientId: string, corr: string, createdAt: Date, o: { result: string; action?: string; status?: string; suppression?: unknown }) {
      return { clientId, engineVersion: "v2.0.0-shadow", correlationId: `corr_${corr}`, result: o.result, action: o.action ?? "nudge", programme: "kyc", reason: "KYC pending for 6 days", priority: "high", priorityScore: 70, owner: "RM", channel: "whatsapp", timing: "today", confidence: "medium", evidence: [{ kind: "fact", ref: "stage:KYC", text: "Customer is in the KYC stage", observedAt: createdAt.toISOString(), confirmation: "confirmed" }], scoreInputs: [], suppression: (o.suppression ?? []) as object, policyResult: { consent: "ok", consentPurpose: "MARKETING_COMMS", consentReason: null, window: "ok", guardrails: "ok", approvalNeeded: true, approver: "RM" }, alternatives: [], inputHash: corr, status: o.status ?? "OPEN", observedAt: createdAt, createdAt };
    }
    function run(purposeId: string, clientId: string, createdAt: Date) {
      return { agentKey: "wa_nudger", purposeId, provider: "fake", model: "fake", promptId: "p", promptVersion: "1", inputClass: "customer_facts", status: "OK" as const, correlationId: RUN_CORR, subjectType: "client", subjectId: clientId, retainUntil: t(-90 * DAY), createdAt, costUsdEstimate: 0.001 };
    }
    ids.prop1 = prop.id;
    ids.msg1 = msg.id;
  });

  afterAll(async () => {
    await db.customerEvent.deleteMany({ where: { OR: [{ clientId: { in: Object.values(clients) } }, { correlationId: CORR_AD }] } });
    await db.approvalRequest.deleteMany({ where: { correlationId: CORR_AD } });
    await db.agentRun.deleteMany({ where: { correlationId: RUN_CORR } });
  });

  const rmEnv = (on: boolean) => { if (on) process.env.NBA_RM_VISIBLE = "1"; else delete process.env.NBA_RM_VISIBLE; };

  it("chain 2 (AI draft approved, then sent) as ONE entry from real rows: decision, draft, approval, message, events, audit, runs, reply", async () => {
    rmEnv(true);
    const r = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("rm1", "RM"), now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.entries.find((e) => e.kind === "message");
    expect(m).toBeDefined();
    expect(m?.id).toBe(`Message:${ids.msg1}`);
    expect(m?.decision).toMatchObject({ engineVersion: "v2.0.0-shadow", result: "RECOMMEND" });
    expect(m?.initiatedBy).toMatchObject({ type: "agent", id: "wa_nudger" });
    expect(m?.executedBy).toMatchObject({ type: "user", id: ids.rm1 });
    expect(m?.approval).toMatchObject({ state: "executed", by: { id: ids.rm1 } });
    expect(m?.ai).toMatchObject({ agentKey: "wa_nudger", level: 3, runs: { count: 2, confidence: "inferred" } });
    expect(m?.confidence).toBe("certain");
    const tables = new Set(m?.sources.map((s) => s.table));
    for (const x of ["DecisionRecord", "AgentProposal", "Message", "CustomerEvent", "AuditLog", "AgentRun"]) expect(tables.has(x)).toBe(true);
    expect(m?.followOn.some((s) => /replied|response/i.test(s.title))).toBe(true);
    expect(m?.evidence.some((e) => /consent at the time/i.test(e.label))).toBe(true);
    expect(r.entries.filter((e) => e.kind === "message" || e.kind === "draft")).toHaveLength(1);
  });

  it("chain 1 (complaint resolved, then review scheduled): the task is an INFERRED follow-on, the complaint is certain", async () => {
    const r = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("rm1", "RM"), now });
    if (!r.ok) throw new Error("expected ok");
    const service = r.entries.find((e) => e.kind === "service");
    const task = r.entries.find((e) => e.kind === "task");
    expect(service?.confidence).toBe("certain");
    expect(service?.followOn.find((s) => s.source.table === "Task")).toMatchObject({ confidence: "inferred" });
    expect(task).toMatchObject({ confidence: "inferred" });
    expect(task?.score).toBeLessThan(1);
    expect(task?.inferredLinks[0].because).toMatch(/same customer/i);
  });

  it("chain 3 (decision suppressed): a decision entry that says nothing was sent", async () => {
    const r = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("mgr", "MANAGER"), now });
    if (!r.ok) throw new Error("expected ok");
    const d = r.entries.find((e) => e.kind === "decision" && /no action/i.test(e.action.label));
    expect(d?.decision?.suppressions[0]).toMatchObject({ rule: "open_complaint" });
    expect(d?.result?.label).toMatch(/nothing was sent/i);
    expect(d?.approval.state).toBe("not_required");
  });

  it("chain 4 (ad recommendation applied): joined on correlation and causation; visible to ADMIN through investigate, as a campaign entry to MARKETING", async () => {
    const adm = await ledger.getActionLedger({ type: "correlation", id: CORR_AD }, { viewer: view("admin", "ADMIN"), now });
    if (!adm.ok) throw new Error("expected ok");
    expect(adm.entries).toHaveLength(1);
    expect(adm.entries[0]).toMatchObject({ kind: "campaign", confidence: "certain" });
    expect(adm.entries[0].action.label).toMatch(/applied/i);
    expect(adm.entries[0].approval).toMatchObject({ state: "executed", by: { id: ids.mkt } });
    const mkt = await ledger.getActionLedger({ type: "campaign", id: null }, { viewer: view("mkt", "MARKETING"), now });
    if (!mkt.ok) throw new Error("expected ok");
    expect(mkt.entries.some((e) => e.kind === "campaign" && /applied/i.test(e.action.label))).toBe(true);
  });

  it("MARKETING: no customer ledger, and the campaign view is aggregated and pseudonymous (no customer id, code, name or phone anywhere in the answer)", async () => {
    expect(await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("mkt", "MARKETING"), now })).toEqual({ ok: false, reason: "forbidden" });
    const mkt = await ledger.getActionLedger({ type: "campaign", id: null }, { viewer: view("mkt", "MARKETING"), now });
    if (!mkt.ok) throw new Error("expected ok");
    const agg = mkt.entries.find((e) => e.aggregate);
    expect(agg?.aggregate?.count).toBeGreaterThan(0);
    expect(agg?.aggregate?.pseudonyms[0]).toMatch(/^P-[0-9a-f]{10}$/);
    const json = JSON.stringify(mkt);
    expect(json).not.toContain(clients.A);
    expect(json).not.toContain("LED-A");
    expect(json).not.toContain("Ledger Customer");
    expect(json).not.toContain("+9198000");
  });

  it("the campaign view is for MARKETING (and admin) only: an RM, a manager and finance are refused", async () => {
    for (const [key, role] of [["rm1", "RM"], ["mgr", "MANAGER"], ["rm2", "FINANCE"]] as const) expect(await ledger.getActionLedger({ type: "campaign", id: null }, { viewer: view(key, role), now })).toEqual({ ok: false, reason: "forbidden" });
    expect((await ledger.getActionLedger({ type: "campaign", id: null }, { viewer: view("admin", "ADMIN"), now })).ok).toBe(true);
  });

  it("an RM sees only own customers: another RM's customer is 'not found', identical to one that does not exist", async () => {
    const other = await ledger.getActionLedger({ type: "client", id: clients.B }, { viewer: view("rm1", "RM"), now });
    const missing = await ledger.getActionLedger({ type: "client", id: "no-such-customer" }, { viewer: view("rm1", "RM"), now });
    expect(other).toEqual({ ok: false, reason: "not_found" });
    expect(missing).toEqual(other);
    const own = await ledger.getActionLedger({ type: "client", id: clients.B }, { viewer: view("rm2", "RM"), now });
    expect(own.ok).toBe(true);
  });

  it("a MANAGER sees their team's customers only; an ADMIN sees all", async () => {
    expect((await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("mgr", "MANAGER"), now })).ok).toBe(true);
    expect(await ledger.getActionLedger({ type: "client", id: clients.B }, { viewer: view("mgr", "MANAGER"), now })).toEqual({ ok: false, reason: "not_found" });
    expect((await ledger.getActionLedger({ type: "client", id: clients.B }, { viewer: view("admin", "ADMIN"), now })).ok).toBe(true);
  });

  it("decision records follow the decision rule: an RM sees none unless NBA_RM_VISIBLE is on; the message entry survives without its decision", async () => {
    rmEnv(false);
    const r = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("rm1", "RM"), now });
    if (!r.ok) throw new Error("expected ok");
    expect(r.hidden.decisions).toBe(true);
    expect(r.entries.some((e) => e.kind === "decision")).toBe(false);
    const m = r.entries.find((e) => e.kind === "message");
    expect(m?.decision).toBeNull();
    expect(JSON.stringify(r)).not.toContain("DecisionRecord");
    rmEnv(true);
  });

  it("the investigate subjects are ADMIN only", async () => {
    for (const subject of [{ type: "correlation", id: CORR_AD }, { type: "agentRun", id: "x" }, { type: "approval", id: "x" }] as const) {
      for (const role of ["RM", "MANAGER", "MARKETING"] as const) expect(await ledger.getActionLedger(subject, { viewer: view(role === "RM" ? "rm1" : role === "MANAGER" ? "mgr" : "mkt", role), now })).toEqual({ ok: false, reason: "forbidden" });
    }
  });

  it("investigate by agent run and by approval reaches the same entry", async () => {
    const run = await db.agentRun.findFirst({ where: { correlationId: RUN_CORR, purposeId: "nudger.draft" } });
    const byRun = await ledger.getActionLedger({ type: "agentRun", id: run?.id ?? "" }, { viewer: view("admin", "ADMIN"), now });
    if (!byRun.ok) throw new Error("expected ok");
    expect(byRun.entries.map((e) => e.id)).toContain(`Message:${ids.msg1}`);
    const byApproval = await ledger.getActionLedger({ type: "approval", id: `agent-proposal:${ids.prop1}` }, { viewer: view("admin", "ADMIN"), now });
    if (!byApproval.ok) throw new Error("expected ok");
    expect(byApproval.entries.map((e) => e.id)).toContain(`Message:${ids.msg1}`);
  });

  it("no message body, draft body, complaint text or phone is anywhere in any answer", async () => {
    rmEnv(true);
    const out = JSON.stringify([
      await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("admin", "ADMIN"), now }),
      await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("rm1", "RM"), now }),
    ]);
    for (const secret of ["SECRET OUTBOUND BODY", "SECRET INBOUND BODY", "SECRET DRAFT BODY", "RAW COMPLAINT WORDS", "+919800000000", "+9198000"]) expect(out).not.toContain(secret);
  });

  it("paginates and filters by kind", async () => {
    const first = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("admin", "ADMIN"), now, limit: 2 });
    if (!first.ok) throw new Error("expected ok");
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("admin", "ADMIN"), now, limit: 2, before: first.nextCursor });
    if (!second.ok) throw new Error("expected ok");
    expect(second.entries.every((e) => e.at < (first.nextCursor as string))).toBe(true);
    const onlyTasks = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("admin", "ADMIN"), now, kinds: ["task"] });
    if (!onlyTasks.ok) throw new Error("expected ok");
    expect(onlyTasks.entries.length).toBeGreaterThan(0);
    expect(onlyTasks.entries.every((e) => e.kind === "task")).toBe(true);
  });

  it("the statement count is flat: a customer with 400 tasks costs the same statements as one with a few", async () => {
    const small = await ledger.getActionLedger({ type: "client", id: clients.A }, { viewer: view("admin", "ADMIN"), now });
    const big = await db.client.create({ data: { clientCode: "LED-BIG", name: "Ledger Big", currentStageId: (await db.stage.findFirstOrThrow({ where: { name: "Led test stage" } })).id, assignedToId: ids.rm1 } });
    clients.BIG = big.id;
    await db.task.createMany({ data: Array.from({ length: 400 }, (_, i) => ({ clientId: big.id, assignedToId: ids.rm1, title: `Bulk task ${i}`, dueAt: t(-DAY), source: "manual", createdAt: t(i * HOUR) })) });
    const large = await ledger.getActionLedger({ type: "client", id: big.id }, { viewer: view("admin", "ADMIN"), now, limit: 25 });
    if (!small.ok || !large.ok) throw new Error("expected ok");
    expect(large.entries).toHaveLength(25);
    expect(large.olderNotShown).toBe(true);
    // 12 + 6 + 2 statements when every optional lookup runs; a lookup with nothing to look for is skipped, never repeated per row.
    expect(large.stats.queries).toBeLessThanOrEqual(20);
    expect(small.stats.queries).toBeLessThanOrEqual(20);
    expect(large.stats.rowsRead).toBeLessThan(400);
    console.info(`ledger statements per page: ${large.stats.queries}; rows read: ${large.stats.rowsRead}`);
  });

  it("the lookups are index seeks: the two indexes exist and the planner uses them (sequential scans forced off)", async () => {
    const plan = async (sql: string) => (await db.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off"); return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${sql}`); })).map((r) => r["QUERY PLAN"]).join("\n");
    expect(await plan(`SELECT id FROM "Task" WHERE "clientId" = '${clients.A}' ORDER BY "createdAt" DESC LIMIT 50`)).toContain("Task_clientId_createdAt_idx");
    expect(await plan(`SELECT id FROM "AgentRun" WHERE "subjectType" = 'client' AND "subjectId" = '${clients.A}' ORDER BY "createdAt" DESC LIMIT 50`)).toContain("AgentRun_subjectType_subjectId_createdAt_idx");
    expect(await plan(`SELECT id FROM "CustomerEvent" WHERE "correlationId" = 'x'`)).toContain("CustomerEvent_correlationId_idx");
    expect(await plan(`SELECT id FROM "AuditLog" WHERE "entity" = 'Client' AND "entityId" = '${clients.A}'`)).toContain("AuditLog_entity_entityId_idx");
  });
});
