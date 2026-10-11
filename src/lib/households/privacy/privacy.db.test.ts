/**
 * Real-database tests of the household privacy walls, calling the real loaders as every role:
 *   HOUSEHOLD_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/households/privacy/privacy.db.test.ts
 * Household: A and C belong to RM1 (team of MANAGER1), B belongs to RM2 (team of MANAGER2). B carries probes that must not
 * reach anyone looking after A and C unless B consented, and never for memory or contact details.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.HOUSEHOLD_DB_TEST === "1" && local;

const B_NAME = "Wyndolyn Prasthaan";
const B_PHONE = "9345012876";
const B_EMAIL = "wyndolyn.prasthaan@example.test";
const B_PAN = "QWYND7654K";
const B_MEMORY = "Wyndolyn mentioned a private medical-leave plan";
const PROBES = [B_NAME, "Prasthaan", B_PHONE, B_EMAIL, B_PAN, B_MEMORY, "7654"];
const NOW = new Date("2027-06-30T10:00:00Z");

describe.skipIf(!enabled)("household privacy walls (real database)", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let load: typeof import("./load");
  const id: Record<string, string> = {};
  let hh = ""; let hhOther = "";

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    load = await import("./load");
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "HH stage", sequence: 9301, slaHours: 24 } }));
    const user = (key: string, role: "RM" | "MANAGER" | "ADMIN" | "MARKETING" | "FINANCE", managerId?: string) => db.user.upsert({ where: { email: `hh-${key}@example.test` }, update: {}, create: { name: key, email: `hh-${key}@example.test`, passwordHash: "x", role, managerId } }).then((u) => (id[key] = u.id));
    await user("mgr1", "MANAGER"); await user("mgr2", "MANAGER"); await user("mgr3", "MANAGER");
    await user("rm1", "RM", id.mgr1); await user("rm2", "RM", id.mgr2); await user("admin", "ADMIN"); await user("mkt", "MARKETING"); await user("fin", "FINANCE");
    const client = (key: string, code: string, name: string, rm: string, extra: object = {}) => db.client.create({ data: { clientCode: code, name, currentStageId: stage.id, assignedToId: id[rm], ...extra } }).then((c) => (id[key] = c.id));
    await client("A", "HHP-A", "Anaya Fernsby", "rm1");
    await client("C", "HHP-C", "Cedric Fernsby", "rm1");
    await client("B", "HHP-B", B_NAME, "rm2", { mobile: B_PHONE, email: B_EMAIL, pan: B_PAN });
    const h = await db.household.create({ data: { householdCode: "HHP-0001", name: "Fernsby household", members: { create: [{ clientId: id.A, relationship: "Self", isPrimary: true }, { clientId: id.B, relationship: "Spouse" }, { clientId: id.C, relationship: "Child" }] } } });
    hh = h.id;
    const stranger = await db.client.create({ data: { clientCode: "HHP-S", name: "Stranger Solo", currentStageId: stage.id, assignedToId: id.rm2 } });
    id.S = stranger.id;
    const h2 = await db.household.create({ data: { householdCode: "HHP-0002", name: "Solo", members: { create: [{ clientId: id.S, relationship: "Self", isPrimary: true }] } } });
    hhOther = h2.id;
    // B's memory item and a complaint: must never reach A's side
    await db.customerMemoryItem.create({ data: { clientId: id.B, class: "FACT", key: "fact:note", value: { text: B_MEMORY }, sourceType: "rm_entry", sourceRef: `user:${id.rm2}`, evidence: [], confidence: "HIGH", observedAt: NOW, confirmation: "CONFIRMED", createdByType: "RM" } });
    await db.complaint.create({ data: { clientId: id.B, title: `Complaint by ${B_NAME}`, severity: "HIGH", sourceType: "MANUAL", openedAt: NOW, slaDueAt: new Date(NOW.getTime() + 86_400_000) } });
    const acct = await db.tradingAccount.create({ data: { clientId: id.B, accountNumber: "HHP-ACC-1", accountType: "EQUITY" } as never });
    const product = await db.product.create({ data: { name: "HH Test Fund", category: "MUTUAL_FUND", productCode: "HHP-P1" } });
    await db.position.create({ data: { tradingAccountId: acct.id, productId: product.id, asOfDate: new Date(NOW.getTime() - 86_400_000), quantity: 10, currentValue: 7_654_321, sourceSystem: "hh-test", externalRef: "hhp-pos-1" } });
  });

  afterAll(async () => {
    if (!db) return;
    const ids = Object.values(id).filter((v) => v);
    const clientIds = [id.A, id.B, id.C, id.S].filter(Boolean);
    await db.householdRelationshipConsent.deleteMany({ where: { householdId: { in: [hh, hhOther] } } });
    await db.complaint.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.customerMemoryItem.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.position.deleteMany({ where: { tradingAccount: { clientId: { in: clientIds } } } });
    await db.tradingAccount.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.product.deleteMany({ where: { productCode: "HHP-P1" } });
    await db.householdMember.deleteMany({ where: { householdId: { in: [hh, hhOther] } } });
    await db.household.deleteMany({ where: { id: { in: [hh, hhOther] } } });
    await db.client.deleteMany({ where: { id: { in: clientIds } } });
    void ids;
    await db.$disconnect();
  });

  const as = (key: string, role: string) => ({ userId: id[key], role });
  const leaked = (v: unknown) => { const t = JSON.stringify(v); return PROBES.filter((p) => t.includes(p)); };

  describe("the summary, as every role", () => {
    it.each([["rm1", "RM"], ["rm2", "RM"], ["mkt", "MARKETING"], ["fin", "FINANCE"]])("%s (%s) gets no household summary at all", async (key, role) => {
      expect(await load.loadHouseholdSummary(as(key, role), hh, NOW)).toBeNull();
    });
    it("a manager who looks after nobody in the household does not learn that it exists", async () => {
      expect(await load.loadHouseholdSummary(as("mgr3", "MANAGER"), hh, NOW)).toBeNull();
    });
    it("MANAGER1 (A and C are theirs) sees those two fully and B only as 'another household member': no probe anywhere", async () => {
      const s = (await load.loadHouseholdSummary(as("mgr1", "MANAGER"), hh, NOW))!;
      expect(s.members).toHaveLength(3);
      expect(s.members.filter((m) => m.inScope)).toHaveLength(2);
      const hidden = s.members.find((m) => !m.inScope)!;
      expect(hidden).toMatchObject({ relationshipExists: true, identity: { visible: false }, portfolio: { visible: false }, service: { visible: false }, relationshipType: { visible: false } });
      expect(leaked(s)).toEqual([]);
      expect(JSON.stringify(s)).not.toContain("Spouse");
      expect(s.wall.hiddenMembers).toBe(1);
      expect(s.aggregate.partial).toBe(true);
    });
    it("MANAGER2 (B is theirs) sees B fully, with the amount, and A and C only as existing", async () => {
      const s = (await load.loadHouseholdSummary(as("mgr2", "MANAGER"), hh, NOW))!;
      const b = s.members.find((m) => m.inScope)!;
      expect(b.identity).toMatchObject({ visible: true, value: { name: B_NAME } });
      expect(b.portfolio).toMatchObject({ visible: true, value: { aum: 7_654_321 } });
      expect(b.service.value).toEqual({ openComplaints: 1, overdueCommitments: 0 });
      expect(JSON.stringify(s)).not.toContain("Anaya");
      expect(JSON.stringify(s)).not.toContain("Cedric");
    });
    it("ADMIN sees the whole household (admin scope is everyone)", async () => {
      const s = (await load.loadHouseholdSummary(as("admin", "ADMIN"), hh, NOW))!;
      expect(s.members.every((m) => m.identity.visible)).toBe(true);
      expect(s.wall.hiddenMembers).toBe(0);
    });
  });

  describe("the Customer 360 household line (RM)", () => {
    it("RM1 on A: the relationship exists, C is theirs, B is behind the wall; no probe", async () => {
      const c = (await load.loadHouseholdContext(as("rm1", "RM"), id.A))!;
      expect(c).toMatchObject({ inHousehold: true, otherMemberCount: 2, hiddenMemberCount: 1 });
      expect(c.ownMembers.map((m) => m.clientCode)).toEqual(["HHP-C"]);
      expect(leaked(c)).toEqual([]);
    });
    it("RM2 on B: both others are hidden; nothing about them", async () => {
      const c = (await load.loadHouseholdContext(as("rm2", "RM"), id.B))!;
      expect(c).toMatchObject({ otherMemberCount: 2, hiddenMemberCount: 2, ownMembers: [] });
      expect(JSON.stringify(c)).not.toContain("Fernsby");
    });
    it("a customer in no household reports that, honestly", async () => {
      expect(await load.loadHouseholdContext(as("rm2", "RM"), id.S)).toMatchObject({ inHousehold: true, otherMemberCount: 0 }); // solo household
    });
    it("RM2 cannot ask about A, MARKETING cannot ask about anyone", async () => {
      expect(await load.loadHouseholdContext(as("rm2", "RM"), id.A)).toBeNull();
      expect(await load.loadHouseholdContext(as("mkt", "MARKETING"), id.A)).toBeNull();
    });
  });

  describe("relationship consent", () => {
    it("only someone who looks after the SUBJECT member can record it; RM1 cannot grant for B", async () => {
      expect(await load.recordRelationshipConsent(as("rm1", "RM"), { householdId: hh, subjectClientId: id.B, granteeClientId: null, status: "GRANTED", scopes: ["member_identity"], now: NOW })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await load.recordRelationshipConsent(as("mkt", "MARKETING"), { householdId: hh, subjectClientId: id.B, granteeClientId: null, status: "GRANTED", scopes: ["member_identity"], now: NOW })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    });
    it("memory, contact details and the relationship itself cannot be shared, empty is refused, and the grantee must be a member", async () => {
      const base = { householdId: hh, subjectClientId: id.B, granteeClientId: null, status: "GRANTED" as const, now: NOW };
      for (const scopes of [["memory_confirmed"], ["contact_details"], ["relationship_exists"], []]) expect(await load.recordRelationshipConsent(as("rm2", "RM"), { ...base, scopes }), JSON.stringify(scopes)).toMatchObject({ ok: false, code: "INVALID" });
      expect(await load.recordRelationshipConsent(as("rm2", "RM"), { ...base, scopes: ["member_identity"], granteeClientId: id.S })).toMatchObject({ ok: false, code: "INVALID" });
      expect(await load.recordRelationshipConsent(as("rm2", "RM"), { ...base, scopes: ["member_identity"], granteeClientId: id.B })).toMatchObject({ ok: false, code: "INVALID" });
    });
    it("B's RM records consent for identity: MANAGER1 now sees B's name but still not the portfolio, the memory or the contact details", async () => {
      expect(await load.recordRelationshipConsent(as("rm2", "RM"), { householdId: hh, subjectClientId: id.B, granteeClientId: null, status: "GRANTED", scopes: ["member_identity"], now: new Date(NOW.getTime() - 1000) })).toMatchObject({ ok: true });
      const s = (await load.loadHouseholdSummary(as("mgr1", "MANAGER"), hh, NOW))!;
      const b = s.members.find((m) => !m.inScope)!;
      expect(b.identity).toMatchObject({ visible: true, value: { name: B_NAME } });
      expect(b.portfolio.visible).toBe(false);
      expect(JSON.stringify(s)).not.toContain(B_PHONE);
      expect(JSON.stringify(s)).not.toContain(B_EMAIL);
      expect(JSON.stringify(s)).not.toContain(B_PAN);
      expect(JSON.stringify(s)).not.toContain(B_MEMORY);
      expect(JSON.stringify(s)).not.toContain("7654321");
    });
    it("a portfolio consent shows a band, not the amount", async () => {
      await load.recordRelationshipConsent(as("rm2", "RM"), { householdId: hh, subjectClientId: id.B, granteeClientId: null, status: "GRANTED", scopes: ["member_identity", "portfolio_summary"], now: new Date(NOW.getTime() - 500) });
      const s = (await load.loadHouseholdSummary(as("mgr1", "MANAGER"), hh, NOW))!;
      const b = s.members.find((m) => !m.inScope)!;
      expect(b.portfolio).toMatchObject({ visible: true, value: { band: "10 lakh to 1 crore", aum: null } });
      expect(JSON.stringify(s)).not.toContain("7654321");
    });
    it("withdrawal closes the wall again, immediately", async () => {
      expect(await load.recordRelationshipConsent(as("rm2", "RM"), { householdId: hh, subjectClientId: id.B, granteeClientId: null, status: "WITHDRAWN", scopes: [], now: new Date(NOW.getTime() - 100) })).toMatchObject({ ok: true });
      const s = (await load.loadHouseholdSummary(as("mgr1", "MANAGER"), hh, NOW))!;
      expect(leaked(s)).toEqual([]);
      expect(s.members.find((m) => !m.inScope)!.identity.visible).toBe(false);
    });
    it("every consent change left an audit row with ids and scopes, never a name", async () => {
      const audits = await db.auditLog.findMany({ where: { entity: "HouseholdRelationshipConsent" } });
      expect(audits.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(audits, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("Wyndolyn");
    });
  });
  describe("the Households LIST (privacy fix: it used to show household-wide AUM and every member's name to a manager with one member in scope)", () => {
    const row = (rows: Awaited<ReturnType<typeof import("./load")["loadHouseholdList"]>>) => rows.find((r) => r.householdCode === "HHP-0001");
    it("a manager looking after A and C sees their names, one hidden member, and only their own AUM: nothing of B, not even the household-wide total", async () => {
      const rows = await load.loadHouseholdList(as("mgr1", "MANAGER"), NOW);
      const r = row(rows)!;
      expect(r.memberNames.sort()).toEqual(["Anaya Fernsby", "Cedric Fernsby"]);
      expect(r.hiddenMembers).toBe(1);
      expect(r.partial).toBe(true);
      expect(r.aum).toBe(0); // A and C hold nothing; B's 76,54,321 is not theirs to see
      expect(leaked(rows)).toEqual([]);
      expect(JSON.stringify(rows)).not.toContain("7654321");
      expect(rows.some((x) => x.householdCode === "HHP-0002")).toBe(false); // a household with nobody in scope is not even listed
    });
    it("B's relationship consent for identity reveals B's name to that household's other RMs, never B's holdings, memory or contact details", async () => {
      await db.householdRelationshipConsent.deleteMany({ where: { householdId: hh } }); // earlier tests in this file leave their own rows: start from none
      await db.householdRelationshipConsent.create({ data: { householdId: hh, subjectClientId: id.B, granteeClientId: null, scopes: ["member_identity"], status: "GRANTED", source: "test", capturedAt: new Date(NOW.getTime() - 86_400_000) } });
      try {
        const r = row(await load.loadHouseholdList(as("mgr1", "MANAGER"), NOW))!;
        expect(r.memberNames).toContain(B_NAME);
        expect(r.hiddenMembers).toBe(0);
        expect(r.aum).toBe(0);
        expect(JSON.stringify(r)).not.toMatch(/7654321|9345012876|QWYND7654K|medical-leave/);
      } finally {
        await db.householdRelationshipConsent.deleteMany({ where: { householdId: hh } });
      }
    });
    it("an admin sees every member and the full household total; the other manager sees the household through B and not A and C's names", async () => {
      const admin = row(await load.loadHouseholdList(as("admin", "ADMIN"), NOW))!;
      expect(admin.memberNames).toContain(B_NAME);
      expect(admin.aum).toBe(7_654_321);
      expect(admin.partial).toBe(false);
      const mgr2 = row(await load.loadHouseholdList(as("mgr2", "MANAGER"), NOW))!;
      expect(mgr2.memberNames).toEqual([B_NAME]);
      expect(mgr2.aum).toBe(7_654_321);
      expect(mgr2.hiddenMembers).toBe(2);
      expect(JSON.stringify(mgr2.memberNames)).not.toMatch(/Fernsby/); // the household's own label is shared; the members' names are not
    });
    it.each([["rm1", "RM"], ["mkt", "MARKETING"], ["fin", "FINANCE"]])("%s (%s) gets no list", async (key, role) => {
      expect(await load.loadHouseholdList(as(key, role), NOW)).toEqual([]);
    });
  });
});
