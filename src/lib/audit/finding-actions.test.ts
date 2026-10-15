import { describe, expect, it } from "vitest";

import { actOnFinding, type FindingActionPort, type FindingDbStatus, type FindingForAction, mayAct } from "./finding-actions";

const NOW = new Date("2026-10-13T10:00:00Z");
type Role = "ADMIN" | "MANAGER" | "RM" | "MARKETING" | "FINANCE";

function fakePort(findings: FindingForAction[]) {
  const applied: { findingId: string; to: FindingDbStatus; actorId: string; at: Date; action: string; note: string | null }[] = [];
  const port: FindingActionPort = {
    async load(id) {
      return findings.find((f) => f.id === id) ?? null;
    },
    async apply(input) {
      const f = findings.find((x) => x.id === input.findingId);
      if (!f || !input.from.includes(f.status)) return false;
      f.status = input.to;
      applied.push({ findingId: input.findingId, to: input.to, actorId: input.actorId, at: input.at, action: input.action, note: input.note });
      return true;
    },
  };
  return { port, applied, findings };
}

const mine = (status: FindingDbStatus = "OPEN"): FindingForAction => ({ id: "f1", status, clientId: "c1", clientAssignedToId: "rm1" });
const theirs = (status: FindingDbStatus = "OPEN"): FindingForAction => ({ id: "f1", status, clientId: "c1", clientAssignedToId: "rm2" });
/** A manager "boss" whose visible set is self and one direct report, rm1. rm2 is not a report. */
const actor = (role: Role, userId = "rm1", visibleUserIds: string[] | null = null) => ({ userId, role, visibleUserIds });
const bossVisible = ["boss", "rm1"];

describe("who may act on a finding", () => {
  it("ADMIN may acknowledge, resolve and dismiss any finding, including one with no customer", () => {
    for (const action of ["acknowledge", "resolve", "dismiss"] as const) {
      expect(mayAct(actor("ADMIN", "root", null), theirs(), action)).toBe(true);
      expect(mayAct(actor("ADMIN", "root", null), { id: "f1", status: "OPEN", clientId: null, clientAssignedToId: null }, action)).toBe(true);
    }
  });

  it("a MANAGER may act on a finding whose customer is with a direct report", () => {
    for (const action of ["acknowledge", "resolve", "dismiss"] as const) {
      expect(mayAct(actor("MANAGER", "boss", bossVisible), mine(), action)).toBe(true);
    }
  });

  it("a MANAGER may not act on a finding whose customer is with an RM who is not their report", () => {
    const nonReport = { id: "f1", status: "OPEN" as const, clientId: "c9", clientAssignedToId: "rm-other" };
    for (const action of ["acknowledge", "resolve", "dismiss"] as const) {
      expect(mayAct(actor("MANAGER", "boss", bossVisible), nonReport, action)).toBe(false);
    }
  });

  it("a MANAGER may not act on a finding with no customer, or with a customer no one is assigned to", () => {
    expect(mayAct(actor("MANAGER", "boss", bossVisible), { id: "f1", status: "OPEN", clientId: null, clientAssignedToId: null }, "resolve")).toBe(false);
    expect(mayAct(actor("MANAGER", "boss", bossVisible), { id: "f1", status: "OPEN", clientId: "c1", clientAssignedToId: null }, "resolve")).toBe(false);
  });

  it("a MANAGER with no visible set may act on nothing", () => {
    expect(mayAct(actor("MANAGER", "boss", null), mine(), "resolve")).toBe(false);
  });

  it("an RM may acknowledge a finding on their own customer", () => {
    expect(mayAct(actor("RM", "rm1"), mine(), "acknowledge")).toBe(true);
  });

  it("an RM may not acknowledge a finding on another RM's customer", () => {
    expect(mayAct(actor("RM", "rm1"), theirs(), "acknowledge")).toBe(false);
  });

  it("an RM may not resolve or dismiss, even their own customer's finding", () => {
    expect(mayAct(actor("RM", "rm1"), mine(), "resolve")).toBe(false);
    expect(mayAct(actor("RM", "rm1"), mine(), "dismiss")).toBe(false);
  });

  it("an RM may not act on a finding with no customer", () => {
    expect(mayAct(actor("RM", "rm1"), { id: "f1", status: "OPEN", clientId: null, clientAssignedToId: null }, "acknowledge")).toBe(false);
  });

  it("a manager's action through actOnFinding is refused for a non-report RM's customer, and writes nothing", async () => {
    const nonReport: FindingForAction = { id: "f1", status: "OPEN", clientId: "c9", clientAssignedToId: "rm2" };
    const { port, applied } = fakePort([nonReport]);
    expect(await actOnFinding(port, { findingId: "f1", action: "resolve", actor: actor("MANAGER", "boss", bossVisible), now: NOW })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(applied).toHaveLength(0);
  });

  it("other roles may act on nothing", () => {
    expect(mayAct(actor("MARKETING"), mine(), "acknowledge")).toBe(false);
    expect(mayAct(actor("FINANCE"), mine(), "acknowledge")).toBe(false);
  });
});

describe("actions on a finding", () => {
  it("acknowledge moves OPEN to ACKNOWLEDGED and records the actor and time", async () => {
    const { port, applied } = fakePort([mine()]);
    const r = await actOnFinding(port, { findingId: "f1", action: "acknowledge", actor: actor("RM", "rm1"), now: NOW });
    expect(r).toEqual({ ok: true, status: "ACKNOWLEDGED" });
    expect(applied[0]).toMatchObject({ actorId: "rm1", at: NOW, action: "acknowledge", to: "ACKNOWLEDGED" });
  });

  it("resolve moves OPEN or ACKNOWLEDGED to RESOLVED for a manager over a report's customer", async () => {
    for (const from of ["OPEN", "ACKNOWLEDGED"] as const) {
      const { port, findings } = fakePort([mine(from)]);
      const r = await actOnFinding(port, { findingId: "f1", action: "resolve", actor: actor("MANAGER", "boss", bossVisible), now: NOW });
      expect(r).toEqual({ ok: true, status: "RESOLVED" });
      expect(findings[0].status).toBe("RESOLVED");
    }
  });

  it("dismiss moves to DISMISSED and keeps a trimmed note", async () => {
    const { port, applied } = fakePort([theirs()]);
    await actOnFinding(port, { findingId: "f1", action: "dismiss", actor: actor("ADMIN", "root", null), note: "  checked, not a breach  ", now: NOW });
    expect(applied[0]).toMatchObject({ to: "DISMISSED", note: "checked, not a breach" });
  });

  it("a resolved or dismissed finding is final: no further action", async () => {
    const { port } = fakePort([mine("RESOLVED")]);
    expect(await actOnFinding(port, { findingId: "f1", action: "acknowledge", actor: actor("RM", "rm1"), now: NOW })).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(await actOnFinding(port, { findingId: "f1", action: "dismiss", actor: actor("MANAGER", "boss", bossVisible), now: NOW })).toMatchObject({ ok: false, code: "BAD_STATE" });
  });

  it("acknowledging twice is refused on the second attempt", async () => {
    const { port } = fakePort([mine()]);
    await actOnFinding(port, { findingId: "f1", action: "acknowledge", actor: actor("RM", "rm1"), now: NOW });
    expect(await actOnFinding(port, { findingId: "f1", action: "acknowledge", actor: actor("RM", "rm1"), now: NOW })).toMatchObject({ ok: false, code: "BAD_STATE" });
  });

  it("refuses an RM resolving their own customer's finding, and writes nothing", async () => {
    const { port, applied } = fakePort([mine()]);
    expect(await actOnFinding(port, { findingId: "f1", action: "resolve", actor: actor("RM", "rm1"), now: NOW })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(applied).toHaveLength(0);
  });

  it("reports NOT_FOUND for an unknown finding", async () => {
    const { port } = fakePort([]);
    expect(await actOnFinding(port, { findingId: "nope", action: "acknowledge", actor: actor("MANAGER", "boss", bossVisible), now: NOW })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("rejects an unknown action", async () => {
    const { port } = fakePort([mine()]);
    expect(await actOnFinding(port, { findingId: "f1", action: "delete" as never, actor: actor("MANAGER", "boss", bossVisible), now: NOW })).toMatchObject({ ok: false, code: "INVALID" });
  });
});
