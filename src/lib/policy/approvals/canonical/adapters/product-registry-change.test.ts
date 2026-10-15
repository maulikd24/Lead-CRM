import { describe, expect, it } from "vitest";

import { createApprovalService } from "../service";
import { createProductRegistryChangeAdapter, toCanonicalRegistryChange, type RegistryChangeRow } from "./product-registry-change";

const NOW = new Date("2027-05-02T09:00:00Z");
const maker = { id: "u-a1", role: "ADMIN" } as const;
const checker = { id: "u-a2", role: "ADMIN" } as const;
const rm = { id: "u-rm", role: "RM" } as const;

const row = (over: Partial<RegistryChangeRow> = {}): RegistryChangeRow => ({
  versionId: "v2", productId: "p1", productKey: "example-growth-fund", productName: "Example Growth Fund (EXAMPLE)", isExample: true, productStatus: "APPROVED", versionNo: 2, state: "IN_REVIEW",
  category: "MUTUAL_FUND", riskCategory: "MODERATELY_HIGH", availability: "OPEN", claimCount: 2, createdById: maker.id, submittedAt: NOW, reviewedById: null, reviewedAt: null, reviewNote: null, ...over,
});

function world(initial: Partial<RegistryChangeRow> = {}) {
  let current = row(initial);
  const decided: unknown[] = [];
  const adapter = createProductRegistryChangeAdapter({
    loadAwaiting: async () => (current.state === "IN_REVIEW" ? [current] : []),
    loadRow: async (id) => (id === current.versionId ? current : null),
    decide: async (versionId, decision, note, actor) => {
      decided.push({ versionId, decision, note, actor });
      // the registry's own maker-checker, as lifecycle.ts words it
      if (actor.role !== "ADMIN") return { ok: false as const, error: "Only an Admin can review a version." };
      if (current.createdById === actor.userId) return { ok: false as const, error: "The author cannot approve their own version: a second Admin must review it." };
      if (current.state !== "IN_REVIEW") return { ok: false as const, error: "Only a version that is in review can be decided." };
      current = { ...current, state: decision === "approve" ? "APPROVED" : "REJECTED", reviewedById: actor.userId, reviewedAt: NOW, reviewNote: note };
      return { ok: true as const };
    },
  });
  const svc = createApprovalService({ adapters: { "product-registry-change": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined } as never);
  return { adapter, svc, decided, get current() { return current; } };
}

describe("product registry change as a canonical approval", () => {
  it("maps the version workflow onto canonical states; a draft is not in an approval yet", () => {
    const st = (state: RegistryChangeRow["state"]) => toCanonicalRegistryChange(row({ state }))?.state;
    expect(st("IN_REVIEW")).toBe("requested");
    expect(st("APPROVED")).toBe("approved");
    expect(st("SUPERSEDED")).toBe("approved");
    expect(st("REJECTED")).toBe("rejected");
    expect(st("DRAFT")).toBeUndefined();
  });
  it("carries what the approver must see, four-eyes against the author, and nothing customer-facing", () => {
    const v = toCanonicalRegistryChange(row())!;
    expect(v).toMatchObject({ ref: "product-registry-change:v2", kind: "product-registry-change", id: "v2", requestedBy: { id: "u-a1" }, fourEyesAuthorId: "u-a1", autonomy: "L4", clientId: null });
    expect(v.subject).toMatchObject({ type: "Product registry entry", href: "/settings/product-registry" });
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["change", "risk", "claims"]));
    expect(v.summary).toMatch(/version 2/i);
    expect(v.summary).toMatch(/example/i);
  });
  it("is invisible to anyone who is not an Admin", async () => {
    const w = world();
    expect(await w.adapter.listAwaiting(rm as never, NOW, 10)).toEqual([]);
    expect(await w.adapter.get("v2", rm as never, NOW)).toBeNull();
    expect((await w.adapter.listAwaiting(checker as never, NOW, 10)).map((v) => v.ref)).toEqual(["product-registry-change:v2"]);
  });

  it("the author cannot approve their own version, through the inbox either (four-eyes twice: the service and the registry)", async () => {
    const w = world();
    const r = await w.svc.decide(maker as never, "product-registry-change:v2", "approve", { reason: null });
    expect(r).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(w.decided).toEqual([]); // refused by the service before the registry is called
    expect(w.current.state).toBe("IN_REVIEW");
  });
  it("a second Admin approves through the canonical service and the registry version is approved by the registry's own rule", async () => {
    const w = world();
    const r = await w.svc.decide(checker as never, "product-registry-change:v2", "approve", { reason: null });
    expect(r).toMatchObject({ ok: true, state: "approved" });
    expect(w.decided).toEqual([{ versionId: "v2", decision: "approve", note: null, actor: { userId: "u-a2", role: "ADMIN" } }]);
    expect(w.current).toMatchObject({ state: "APPROVED", reviewedById: "u-a2" });
  });
  it("a reject needs a reason and carries it to the registry", async () => {
    const w = world();
    expect(await w.svc.decide(checker as never, "product-registry-change:v2", "reject", { reason: null })).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    const r = await w.svc.decide(checker as never, "product-registry-change:v2", "reject", { reason: "Minimum investment looks wrong" });
    expect(r).toMatchObject({ ok: true, state: "rejected" });
    expect(w.current).toMatchObject({ state: "REJECTED", reviewNote: "Minimum investment looks wrong" });
  });
  it("registry failures keep their meaning: another role is FORBIDDEN, a decided version is ALREADY_DECIDED", async () => {
    const w = world();
    expect(await w.adapter.decide({ subjectId: "v2", decision: "approve", reason: null, actor: rm as never, now: NOW, params: {} })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await w.svc.decide(checker as never, "product-registry-change:v2", "approve", { reason: null });
    expect(await w.adapter.decide({ subjectId: "v2", decision: "approve", reason: null, actor: checker as never, now: NOW, params: {} })).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
  });
});
