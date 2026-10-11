import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_BRAND_PROFILE } from "./brand";
import { briefInputSchema, generateKit } from "./kit";
import { createCreativeService, type BriefRow, type CreativeStore, type VariantRow } from "./service";

function memoryStore() {
  const briefs = new Map<string, BriefRow>();
  const variants = new Map<string, VariantRow>();
  const events: { variantId: string; action: string; actorId: string; note?: string | null }[] = [];
  let n = 0;
  const store: CreativeStore = {
    async insertBrief(b) { const row = { ...b, id: `b${++n}` }; briefs.set(row.id, row); return row; },
    async insertVariant(v) { const row = { ...v, id: `v${++n}` }; variants.set(row.id, row); return row; },
    async getBrief(id) { return briefs.get(id) ?? null; },
    async getVariant(id) { return variants.get(id) ?? null; },
    async variantsOf(briefId) { return [...variants.values()].filter((v) => v.briefId === briefId); },
    async casUpdateVariant(id, expected, data) { const v = variants.get(id); if (!v || v.status !== expected) return false; variants.set(id, { ...v, ...data }); return true; },
    async updateBriefReferences(id, referenceIds) { const b = briefs.get(id); if (b) briefs.set(id, { ...b, referenceIds }); },
    async addEvent(e) { events.push(e); },
    async deleteBrief(id) { briefs.delete(id); for (const [k, v] of variants) if (v.briefId === id) variants.delete(k); },
  };
  return { store, briefs, variants, events };
}

const audits: { action: string; entityId: string; userId: string }[] = [];
const refCopies: Record<string, string> = {};
const make = () => {
  const mem = memoryStore();
  const svc = createCreativeService({ store: mem.store, getProfile: async () => ({ version: 3, profile: DEFAULT_BRAND_PROFILE }), loadReferenceCopies: async (ids) => ids.map((i) => refCopies[i]).filter(Boolean), audit: async (a) => void audits.push(a), now: () => new Date("2026-10-10T09:00:00Z") });
  return { ...mem, svc };
};

const input = briefInputSchema.parse({ title: "Demat basics", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed", "google_rsa"] });
const author = { id: "u1", role: "MARKETING" };
const reviewer = { id: "u2", role: "ADMIN" };

beforeEach(() => { audits.length = 0; for (const k of Object.keys(refCopies)) delete refCopies[k]; });

describe("creative service", () => {
  it("creates a brief and a checked variant per format, as drafts", async () => {
    const { svc, variants } = make();
    const r = await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: author });
    expect(r.ok).toBe(true);
    expect([...variants.values()]).toHaveLength(2);
    for (const v of variants.values()) {
      expect(v).toMatchObject({ status: "DRAFT", source: "STAFF", complianceStatus: "PASS", authorId: "u1" });
      expect(v.verdict).toBe("scale");
    }
  });

  it("refuses everyone except ADMIN and MARKETING", async () => {
    for (const role of ["MANAGER", "RM", "FINANCE", "DEALER", "PARTNER"]) {
      const { svc, briefs } = make();
      const r = await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: { id: "x", role } });
      expect(r).toMatchObject({ ok: false });
      expect(briefs.size).toBe(0);
    }
  });

  it("walks Draft > Needs review > Approved with a second person, and audits the approval", async () => {
    const { svc, variants, events } = make();
    await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: author });
    const id = [...variants.keys()][0];
    expect((await svc.transition(id, "submit", author)).ok).toBe(true);
    expect(variants.get(id)!.status).toBe("NEEDS_REVIEW");
    expect(await svc.transition(id, "approve", author, { confirmed: true })).toMatchObject({ ok: false });
    expect((await svc.transition(id, "approve", reviewer, { confirmed: true })).ok).toBe(true);
    expect(variants.get(id)).toMatchObject({ status: "APPROVED", approvedById: "u2" });
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["created", "submit", "approve"]));
    expect(audits).toEqual([{ action: "creative_variant_approved", entityId: id, userId: "u2" }]);
  });

  it("recomputes the check on the text as saved: copy edited to break a rule cannot be submitted", async () => {
    const { svc, variants } = make();
    await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: author });
    const id = [...variants.keys()][0];
    const v = variants.get(id)!;
    const edit = await svc.editVariant(id, { fields: { ...v.fields, headline: ["Guaranteed returns", "b", "c"] } }, author);
    expect(edit.ok).toBe(true);
    expect(variants.get(id)).toMatchObject({ complianceStatus: "FAIL", status: "DRAFT" });
    expect(await svc.transition(id, "submit", author)).toMatchObject({ ok: false });
  });

  it("an edit withdraws an approval", async () => {
    const { svc, variants } = make();
    await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: author });
    const id = [...variants.keys()][0];
    await svc.transition(id, "submit", author);
    await svc.transition(id, "approve", reviewer, { confirmed: true });
    const v = variants.get(id)!;
    await svc.editVariant(id, { fields: { ...v.fields } }, reviewer);
    expect(variants.get(id)).toMatchObject({ status: "DRAFT", approvedById: null });
  });

  it("a concurrent change loses: compare-and-set on status", async () => {
    const { svc, variants, store } = make();
    await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: author });
    const id = [...variants.keys()][0];
    const real = store.casUpdateVariant;
    store.casUpdateVariant = async () => false;
    expect(await svc.transition(id, "submit", author)).toMatchObject({ ok: false });
    store.casUpdateVariant = real;
  });

  it("attaching a competitor reference re-checks the copy for echoing", async () => {
    const { svc, variants, briefs } = make();
    const r = await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: author });
    if (!r.ok) throw new Error("setup");
    const id = [...variants.values()].find((v) => v.format === "meta_feed")!.id;
    const v = variants.get(id)!;
    await svc.editVariant(id, { fields: { ...v.fields, primaryText: ["Is your portfolio really working for you or just sitting there"] } }, author);
    refCopies.ad1 = "Is your portfolio really working for you or just sitting there quietly";
    expect((await svc.attachReference(r.briefId, "ad1", author)).ok).toBe(true);
    expect(briefs.get(r.briefId)!.referenceIds).toEqual(["ad1"]);
    expect(variants.get(id)!.complianceStatus).toBe("FAIL");
  });

  it("request changes needs a note and sends the copy back", async () => {
    const { svc, variants } = make();
    await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: author });
    const id = [...variants.keys()][0];
    await svc.transition(id, "submit", author);
    expect(await svc.transition(id, "request_changes", reviewer, {})).toMatchObject({ ok: false });
    expect((await svc.transition(id, "request_changes", reviewer, { note: "Shorten" })).ok).toBe(true);
    expect(variants.get(id)).toMatchObject({ status: "DRAFT", reviewNote: "Shorten" });
  });
});
