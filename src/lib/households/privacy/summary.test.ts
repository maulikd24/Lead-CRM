import { describe, expect, it } from "vitest";

import type { ConsentRow } from "./policy";
import { aumBand, buildHouseholdSummary, type Fetchers, type MemberInput } from "./summary";

const NOW = new Date("2027-06-30T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const members: MemberInput[] = [
  { clientId: "A", name: "Asha Mehta", clientCode: "CL-1", relationship: "Self", isPrimary: true, inScope: true },
  { clientId: "B", name: "Bhaskar Mehta", clientCode: "CL-2", relationship: "Spouse", isPrimary: false, inScope: false },
  { clientId: "C", name: "Chitra Mehta", clientCode: "CL-3", relationship: "Child", isPrimary: false, inScope: false },
];

function fetchers() {
  const calls = { portfolio: [] as string[][], service: [] as string[][] };
  const f: Fetchers = {
    portfolio: async (ids) => {
      calls.portfolio.push([...ids]);
      return new Map(ids.map((id) => [id, { aum: id === "A" ? 12_000_000 : id === "B" ? 3_000_000 : 400_000, accountCount: 2, asOf: day(-1) }]));
    },
    service: async (ids) => {
      calls.service.push([...ids]);
      return new Map(ids.map((id) => [id, { openComplaintCount: id === "B" ? 1 : 0, overdueCommitmentCount: 0, asOf: NOW }]));
    },
  };
  return { f, calls };
}

const consent = (subject: string, scopes: string[], over: Partial<ConsentRow> = {}): ConsentRow => ({ subjectClientId: subject, granteeClientId: null, scopes, status: "GRANTED", capturedAt: day(-3), expiresAt: null, ...over });

const run = (role: string, consents: ConsentRow[] = [], viewerMemberIds = ["A"]) => {
  const { f, calls } = fetchers();
  return buildHouseholdSummary({ role, members, consents, viewerMemberIds, now: NOW, fetchers: f }).then((s) => ({ s, calls }));
};

describe("the household summary honours the wall", () => {
  it("a role outside admin, manager and RM gets nothing, and nothing is fetched", async () => {
    for (const role of ["MARKETING", "FINANCE", "PARTNER", "DEALER", "TEAM_MANAGER", "AFFILIATE", "DISTRIBUTOR"]) {
      const { s, calls } = await run(role);
      expect(s, role).toBeNull();
      expect(calls.portfolio, role).toEqual([]);
    }
  });

  it("without consent a manager sees their own member fully and, for the others, only that the relationship exists", async () => {
    const { s, calls } = await run("MANAGER");
    expect(s!.members).toHaveLength(3);
    const own = s!.members.find((m) => m.inScope)!;
    expect(own.identity).toMatchObject({ visible: true, value: { name: "Asha Mehta", clientCode: "CL-1" } });
    expect(own.portfolio).toMatchObject({ visible: true });
    const others = s!.members.filter((m) => !m.inScope);
    for (const o of others) {
      expect(o.relationshipExists).toBe(true);
      expect(o.identity.visible).toBe(false);
      expect(o.relationshipType.visible).toBe(false);
      expect(o.portfolio.visible).toBe(false);
      expect(o.service.visible).toBe(false);
    }
    // hidden facets are never even queried
    expect(calls.portfolio).toEqual([["A"]]);
    expect(calls.service).toEqual([["A"]]);
  });

  it("nothing about a hidden member leaks anywhere in the output: no name, code, id, amount or relationship", async () => {
    const { s } = await run("RM");
    const text = JSON.stringify(s);
    for (const leak of ["Bhaskar", "Chitra", "CL-2", "CL-3", '"B"', '"C"', "3000000", "400000", "Spouse", "Child"]) expect(text, leak).not.toContain(leak);
  });

  it("with consent for identity only, the name appears but not the portfolio", async () => {
    const { s, calls } = await run("RM", [consent("B", ["member_identity"])]);
    const b = s!.members.find((m) => m.identity.visible && m.identity.value?.clientCode === "CL-2")!;
    expect(b.identity.value).toMatchObject({ name: "Bhaskar Mehta" });
    expect(b.portfolio.visible).toBe(false);
    expect(calls.portfolio).toEqual([["A"]]);
  });

  it("with portfolio consent the member shows a size band, never the exact amount, and the household total leaves them out", async () => {
    const { s, calls } = await run("RM", [consent("B", ["portfolio_summary"])]);
    expect(calls.portfolio[0].sort()).toEqual(["A", "B"]);
    const b = s!.members.find((m) => !m.inScope && m.portfolio.visible)!;
    expect(b.portfolio.value).toMatchObject({ band: "10 lakh to 1 crore" });
    expect(JSON.stringify(b.portfolio)).not.toContain("3000000");
    expect(s!.aggregate).toMatchObject({ aum: 12_000_000, partial: true });
    expect(JSON.stringify(s)).not.toContain("15000000");
  });

  it("service state (counts only) needs its own consent", async () => {
    const { s } = await run("RM", [consent("B", ["service_state"])]);
    const b = s!.members.find((m) => !m.inScope && m.service.visible)!;
    expect(b.service.value).toEqual({ openComplaints: 1, overdueCommitments: 0 });
  });

  it("memory and contact details are not in the summary's vocabulary at all, consent or not", async () => {
    const { s } = await run("MANAGER", [consent("B", ["memory_confirmed", "contact_details", "member_identity"])]);
    const keys = new Set<string>();
    const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(s);
    for (const k of ["memory", "contact", "mobile", "email", "phone", "pan"]) expect([...keys].some((x) => x.toLowerCase().includes(k)), k).toBe(false);
  });

  it("a withdrawn consent hides again", async () => {
    const { s } = await run("RM", [consent("B", ["member_identity"], { capturedAt: day(-9) }), consent("B", ["member_identity"], { status: "WITHDRAWN", capturedAt: day(-1) })]);
    expect(s!.members.filter((m) => m.identity.visible)).toHaveLength(1);
  });

  it("a fully in-scope household (one RM looks after everyone) shows everything, exact amounts included, and a complete total", async () => {
    const { f } = fetchers();
    const all = members.map((m) => ({ ...m, inScope: true }));
    const s = await buildHouseholdSummary({ role: "MANAGER", members: all, consents: [], viewerMemberIds: ["A", "B", "C"], now: NOW, fetchers: f });
    expect(s!.aggregate).toMatchObject({ aum: 15_400_000, partial: false });
    expect(s!.members.every((m) => m.identity.visible)).toBe(true);
  });

  it("reports how much is behind the wall, so the view is honest about being partial", async () => {
    const { s } = await run("RM");
    expect(s!.wall.hiddenMembers).toBe(2);
    expect(s!.wall.note).toMatch(/consent/i);
  });

  it("carries an as-of for the portfolio numbers", async () => {
    const { s } = await run("MANAGER");
    expect(s!.asOf).not.toBeNull();
  });
});

describe("aumBand", () => {
  it("bands", () => {
    expect(aumBand(0)).toBe("under 10 lakh");
    expect(aumBand(3_000_000)).toBe("10 lakh to 1 crore".replace("10 lakh to 1 crore", "10 lakh to 1 crore"));
    expect(aumBand(30_000_000)).toBe("1 crore to 5 crore");
    expect(aumBand(90_000_000)).toBe("over 5 crore");
  });
});
