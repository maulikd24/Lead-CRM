/**
 * Real-database checks of the Product and Eligibility Registry: the draft > review > approved flow with maker-checker, the citation
 * guard against live rows, suspend and retire, the marketing claims loader, the seed and the audit trail.
 * Skipped unless W2C_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own:
 *   W2C_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wt_w2c_main npx vitest run src/lib/registry/service.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(fn: T) => fn }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.W2C_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

const content = (name: string, over: Record<string, unknown> = {}) => ({
  name, category: "AIF", summary: null, availability: "OPEN", minInvestmentMinor: 100000, currency: "INR", riskCategory: "HIGH", jurisdictions: ["IN"],
  requiredDocuments: ["Example document"], eligibility: [{ code: "e1", kind: "investor_type", value: "Example" }], salesRestrictions: [], claims: [{ id: "c1", text: "Example claim", validUntil: null }],
  validFrom: null, validTo: null, ...over,
});

describe.skipIf(!enabled)("product registry (real database)", { timeout: 60_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let svc: typeof import("./service");
  let a1 = { userId: "", role: "ADMIN" };
  let a2 = { userId: "", role: "ADMIN" };

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    svc = await import("./service");
    const mk = (email: string) => db.user.upsert({ where: { email }, update: {}, create: { email, name: email, passwordHash: "x", role: "ADMIN" } });
    a1 = { userId: (await mk("reg-admin-1@example.test")).id, role: "ADMIN" };
    a2 = { userId: (await mk("reg-admin-2@example.test")).id, role: "ADMIN" };
  });
  afterAll(async () => {
    await db.registryProductVersion.deleteMany({});
    await db.registryProduct.deleteMany({});
  });

  it("a new product is not citable until a second admin approves it", async () => {
    const c = await svc.createProduct({ key: "t-flow-product", content: content("Flow") }, a1);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(await svc.cite(c.productId)).toMatchObject({ ok: false, reason: "unapproved" });
    expect(await svc.submitVersion(c.versionId, a1)).toEqual({ ok: true });
    expect(await svc.cite(c.productId)).toMatchObject({ ok: false, reason: "unapproved" }); // in review is still not citable
    expect(await svc.decideVersion(c.versionId, "approve", null, a1)).toMatchObject({ ok: false }); // maker-checker
    expect(await svc.decideVersion(c.versionId, "approve", "ok", a2)).toEqual({ ok: true });
    const cited = await svc.cite(c.productId);
    expect(cited.ok).toBe(true);
    if (cited.ok) {
      expect(cited.versionNo).toBe(1);
      expect(cited.claims).toHaveLength(1);
    }
  });

  it("a non-admin cannot create, submit or approve", async () => {
    const rm = { userId: a1.userId, role: "RM" };
    expect(await svc.createProduct({ key: "t-rm-product", content: content("RM") }, rm)).toMatchObject({ ok: false });
  });

  it("revising keeps the approved version in force until the new one is approved, then supersedes it", async () => {
    const c = await svc.createProduct({ key: "t-revise", content: content("Revise") }, a1);
    if (!c.ok) throw new Error("setup");
    await svc.submitVersion(c.versionId, a1);
    await svc.decideVersion(c.versionId, "approve", null, a2);
    const r = await svc.reviseProduct(c.productId, a1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await svc.reviseProduct(c.productId, a1)).toMatchObject({ ok: false }); // one open version at a time
    await svc.updateDraft(r.versionId, content("Revise v2", { minInvestmentMinor: 200000 }), a1);
    expect((await svc.cite(c.productId)) as { versionNo: number }).toMatchObject({ versionNo: 1 }); // draft changes nothing live
    await svc.submitVersion(r.versionId, a1);
    await svc.decideVersion(r.versionId, "approve", null, a2);
    const now = await svc.cite(c.productId);
    expect(now.ok && now.versionNo).toBe(2);
    expect(now.ok && now.facts.minInvestmentMinor).toBe(200000);
    const detail = await svc.getProduct(c.productId);
    expect(detail?.versions.map((v) => v.state)).toEqual(["APPROVED", "SUPERSEDED"]);
  });

  it("an approved version can never be edited in place", async () => {
    const c = await svc.createProduct({ key: "t-immutable", content: content("Immutable") }, a1);
    if (!c.ok) throw new Error("setup");
    await svc.submitVersion(c.versionId, a1);
    await svc.decideVersion(c.versionId, "approve", null, a2);
    expect(await svc.updateDraft(c.versionId, content("Hacked"), a1)).toMatchObject({ ok: false });
  });

  it("suspend refuses citation at once; approving a new version is the review that reinstates", async () => {
    const c = await svc.createProduct({ key: "t-suspend", content: content("Suspend") }, a1);
    if (!c.ok) throw new Error("setup");
    await svc.submitVersion(c.versionId, a1);
    await svc.decideVersion(c.versionId, "approve", null, a2);
    expect(await svc.suspendProduct(c.productId, "", a1)).toMatchObject({ ok: false });
    expect(await svc.suspendProduct(c.productId, "Regulator query", a1)).toEqual({ ok: true });
    expect(await svc.cite(c.productId)).toMatchObject({ ok: false, reason: "suspended" });
    const r = await svc.reviseProduct(c.productId, a1);
    if (!r.ok) throw new Error("setup");
    await svc.submitVersion(r.versionId, a1);
    await svc.decideVersion(r.versionId, "approve", null, a2);
    expect((await svc.cite(c.productId)).ok).toBe(true);
  });

  it("retire is final: refused for citation and for revision", async () => {
    const c = await svc.createProduct({ key: "t-retire", content: content("Retire") }, a1);
    if (!c.ok) throw new Error("setup");
    await svc.submitVersion(c.versionId, a1);
    await svc.decideVersion(c.versionId, "approve", null, a2);
    expect(await svc.retireProduct(c.productId, "Closed", a1)).toEqual({ ok: true });
    expect(await svc.cite(c.productId)).toMatchObject({ ok: false, reason: "retired" });
    expect(await svc.reviseProduct(c.productId, a1)).toMatchObject({ ok: false });
    expect(await svc.retireProduct(c.productId, "again", a1)).toMatchObject({ ok: false });
  });

  it("cite refuses garbage and unknown ids", async () => {
    expect(await svc.cite("does-not-exist")).toMatchObject({ ok: false, reason: "unknown_product" });
    expect(await svc.cite("")).toMatchObject({ ok: false, reason: "unknown_product" });
    expect(await svc.cite("x".repeat(500))).toMatchObject({ ok: false, reason: "unknown_product" });
  });

  it("the seed creates labelled examples once, and the marketing loader returns approved claims only", async () => {
    const { seedExampleProducts } = await import("./seed-examples");
    expect((await seedExampleProducts(db)).length).toBe(6);
    expect(await seedExampleProducts(db)).toEqual([]); // idempotent
    const claims = await svc.listApprovedClaims();
    const names = new Set(claims.map((c) => c.productName));
    expect(names.has("Example Growth Fund (EXAMPLE)")).toBe(true);
    expect(names.has("Example Paused Product (EXAMPLE)")).toBe(false); // suspended
    expect(names.has("Example Closed Product (EXAMPLE)")).toBe(false); // retired
    expect(names.has("Example Product Under Review (EXAMPLE)")).toBe(false); // draft
    for (const c of claims) expect(Object.keys(c).sort()).toEqual(["claimId", "isExample", "productId", "productName", "text", "validUntil"]); // nothing else leaks
    const ex = await db.registryProduct.findMany({ where: { key: { startsWith: "example-" } } });
    expect(ex.every((p) => p.isExample)).toBe(true);
  });

  it("every change is audited", async () => {
    const n = await db.auditLog.count({ where: { entity: "RegistryProduct", action: { in: ["registry.product_created", "registry.approved", "registry.suspended", "registry.retired"] } } });
    expect(n).toBeGreaterThanOrEqual(8);
  });
  it("Wave 2 integration: the canonical approvals service decides a registry version through the adapter, with four-eyes twice, and the registry ends up exactly where its own path would", async () => {
    const { approvalService } = await import("@/lib/policy/approvals/canonical/wiring");
    const approvals = approvalService();
    const c = await svc.createProduct({ key: "t-canonical", content: content("Canonical") }, a1);
    if (!c.ok) throw new Error("setup");
    expect(await svc.listReviewItems(50)).not.toContainEqual(expect.objectContaining({ versionId: c.versionId })); // a draft is not in review
    await svc.submitVersion(c.versionId, a1);
    const queue = await svc.listReviewItems(50);
    expect(queue.find((q) => q.versionId === c.versionId)).toMatchObject({ createdById: a1.userId, state: "IN_REVIEW", claimCount: 1 });
    const maker = { id: a1.userId, role: "ADMIN" as never, name: null };
    const checker = { id: a2.userId, role: "ADMIN" as never, name: null };
    const ref = `product-registry-change:${c.versionId}`;
    // visible to an Admin in the inbox, invisible to another role
    const list = await approvals.listFor(checker, { tab: "awaiting" });
    expect(list.items.map((i) => i.ref)).toContain(ref);
    expect((await approvals.listFor({ id: a1.userId, role: "RM" as never, name: null }, { tab: "awaiting" })).items.map((i) => i.ref)).not.toContain(ref);
    // the author is refused by the service (four-eyes), nothing changes
    expect(await approvals.decide(maker, ref, "approve", {})).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(await svc.cite(c.productId)).toMatchObject({ ok: false, reason: "unapproved" });
    // a second Admin approves through the canonical service: the registry cites it
    expect(await approvals.decide(checker, ref, "approve", {})).toMatchObject({ ok: true });
    expect(await svc.cite(c.productId)).toMatchObject({ ok: true });
    expect((await svc.getReviewItem(c.versionId))?.state).toBe("APPROVED");
    expect(await approvals.decide(checker, ref, "approve", {})).toMatchObject({ ok: false });
  });
});
