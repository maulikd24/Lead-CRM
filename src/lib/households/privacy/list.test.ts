import { describe, expect, it } from "vitest";

import type { ConsentRow } from "./policy";
import { buildHouseholdList, type ListHousehold } from "./list";

const NOW = new Date("2027-06-01T10:00:00Z");
const member = (clientId: string, name: string, inScope: boolean) => ({ clientId, name, clientCode: `C-${clientId}`, relationship: "SPOUSE", isPrimary: false, inScope });
const hh = (id: string, members: ReturnType<typeof member>[]): ListHousehold => ({ id, name: `Household ${id}`, householdCode: `HH-${id}`, members });
const aum = (entries: Record<string, number>) => new Map(Object.entries(entries));
const consent = (over: Partial<ConsentRow> = {}): ConsentRow => ({ subjectClientId: "m2", granteeClientId: null, scopes: ["member_identity"], status: "GRANTED", capturedAt: new Date("2027-05-01T00:00:00Z"), expiresAt: null, ...over });

describe("the Households list obeys the household walls (privacy fix: it used to show household-wide AUM and every member to a manager with one member in scope)", () => {
  const one = hh("1", [member("m1", "Asha Example", true), member("m2", "Ravi Example", false), member("m3", "Meera Example", false)]);
  const money = aum({ m1: 1_000_000, m2: 90_000_000, m3: 5_000_000 });

  it("a manager with one member in scope sees that member's name, an anonymous count for the rest, and only that member's AUM", () => {
    const [row] = buildHouseholdList({ role: "MANAGER", households: [one], consents: [], now: NOW, aum: money });
    expect(row.memberNames).toEqual(["Asha Example"]);
    expect(row.hiddenMembers).toBe(2);
    expect(row.aum).toBe(1_000_000);
    expect(row.partial).toBe(true);
    expect(JSON.stringify(row)).not.toMatch(/Ravi|Meera|90000000|5000000|91000000|96000000/);
  });
  it("another member's name appears only with that member's relationship consent for member_identity", () => {
    const [row] = buildHouseholdList({ role: "MANAGER", households: [one], consents: [consent()], now: NOW, aum: money });
    expect(row.memberNames).toEqual(["Asha Example", "Ravi Example"]);
    expect(row.hiddenMembers).toBe(1);
    expect(row.aum).toBe(1_000_000); // consent shares a band on the household page, never adds to the list's exact total
  });
  it("a withdrawn or expired consent does not reveal the name", () => {
    expect(buildHouseholdList({ role: "MANAGER", households: [one], consents: [consent({ status: "WITHDRAWN" })], now: NOW, aum: money })[0].memberNames).toEqual(["Asha Example"]);
    expect(buildHouseholdList({ role: "MANAGER", households: [one], consents: [consent({ expiresAt: new Date("2027-05-02T00:00:00Z") })], now: NOW, aum: money })[0].memberNames).toEqual(["Asha Example"]);
  });
  it("memory and contact details never appear, consent or not (the list carries only names and an AUM total)", () => {
    const row = buildHouseholdList({ role: "MANAGER", households: [one], consents: [consent({ scopes: ["member_identity", "memory_confirmed", "contact_details"] })], now: NOW, aum: money })[0];
    expect(Object.keys(row).sort()).toEqual(["aum", "hiddenMembers", "householdCode", "id", "memberNames", "name", "partial", "totalMembers"]);
  });
  it("an admin sees everyone and the full total; an unwalled household is not partial", () => {
    const all = hh("2", [member("m1", "Asha Example", true), member("m2", "Ravi Example", true)]);
    const [row] = buildHouseholdList({ role: "ADMIN", households: [all], consents: [], now: NOW, aum: money });
    expect(row).toMatchObject({ memberNames: ["Asha Example", "Ravi Example"], hiddenMembers: 0, aum: 91_000_000, partial: false, totalMembers: 2 });
  });
  it("a household with no member in the viewer's scope is not listed at all (it must not even be known to exist)", () => {
    expect(buildHouseholdList({ role: "MANAGER", households: [hh("3", [member("m2", "Ravi Example", false)])], consents: [], now: NOW, aum: money })).toEqual([]);
  });
  it("roles outside admin, manager and RM get nothing", () => {
    expect(buildHouseholdList({ role: "MARKETING", households: [one], consents: [], now: NOW, aum: money })).toEqual([]);
  });
  it("a member with no holdings contributes zero, not an unknown", () => {
    const [row] = buildHouseholdList({ role: "MANAGER", households: [hh("4", [member("m9", "No Holdings", true)])], consents: [], now: NOW, aum: new Map() });
    expect(row.aum).toBe(0);
  });
});
