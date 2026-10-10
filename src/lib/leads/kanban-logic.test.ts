import { describe, expect, it } from "vitest";

import { announceDrop, announceLift, canMoveStages, formatWait, groupByStage, moveCard, moveReason, neighbourStage, speedToLead, type BoardCard, type BoardStage } from "./kanban-logic";

const stages: BoardStage[] = [
  { id: "s1", name: "New Lead", sequence: 1 },
  { id: "s2", name: "Submitted for KYC", sequence: 2 },
  { id: "s3", name: "KYC completed", sequence: 3 },
];
const card = (id: string, stageId: string, extra: Partial<BoardCard> = {}): BoardCard => ({ id, name: `Client ${id}`, code: `C-${id}`, stageId, rmId: "u1", rmName: "Asha Rao", campaign: null, createdAtIso: "2026-10-11T05:00:00.000Z", firstContactAtIso: null, priority: "MEDIUM", ...extra });

describe("groupByStage", () => {
  it("gives every stage a column in sequence order, even an empty one, keeping card order", () => {
    const g = groupByStage(stages, [card("a", "s2"), card("b", "s1"), card("c", "s2")]);
    expect(g.map((c) => c.stage.id)).toEqual(["s1", "s2", "s3"]);
    expect(g[1].cards.map((c) => c.id)).toEqual(["a", "c"]);
    expect(g[2].cards).toEqual([]);
  });
  it("ignores a card whose stage is not on the board rather than losing the column", () => {
    const g = groupByStage(stages, [card("a", "gone")]);
    expect(g.every((c) => c.cards.length === 0)).toBe(true);
  });
});

describe("moveCard", () => {
  it("returns a new list with only that card's stage changed", () => {
    const before = [card("a", "s1"), card("b", "s1")];
    const after = moveCard(before, "a", "s3");
    expect(after.find((c) => c.id === "a")?.stageId).toBe("s3");
    expect(after.find((c) => c.id === "b")?.stageId).toBe("s1");
    expect(before[0].stageId).toBe("s1");
  });
  it("is a no-op for an unknown card or the same stage", () => {
    const before = [card("a", "s1")];
    expect(moveCard(before, "zzz", "s2")).toEqual(before);
    expect(moveCard(before, "a", "s1")).toEqual(before);
  });
});

describe("neighbourStage (keyboard dragging)", () => {
  it("steps one column left or right and stops at the ends", () => {
    expect(neighbourStage(stages, "s2", 1)).toBe("s3");
    expect(neighbourStage(stages, "s2", -1)).toBe("s1");
    expect(neighbourStage(stages, "s3", 1)).toBe("s3");
    expect(neighbourStage(stages, "s1", -1)).toBe("s1");
  });
});

describe("canMoveStages", () => {
  it("lets only admins and managers move a stage (the same rule as the real stage correction)", () => {
    expect(canMoveStages("ADMIN")).toBe(true);
    expect(canMoveStages("MANAGER")).toBe(true);
    for (const r of ["RM", "DEALER", "FINANCE", "PARTNER", "TEAM_MANAGER"]) expect(canMoveStages(r)).toBe(false);
  });
});

describe("moveReason", () => {
  it("is a plain sentence naming both stages, and says when it is an undo", () => {
    expect(moveReason("New Lead", "Submitted for KYC")).toBe("Moved from New Lead to Submitted for KYC on the pipeline board");
    expect(moveReason("Submitted for KYC", "New Lead", true)).toBe("Undo: moved back from Submitted for KYC to New Lead on the pipeline board");
  });
});

describe("speedToLead", () => {
  const now = Date.parse("2026-10-11T05:12:00.000Z");
  it("counts the wait for a lead nobody has contacted, calm until the target and a warning after it", () => {
    expect(speedToLead("2026-10-11T05:05:00.000Z", null, now)).toMatchObject({ state: "waiting", label: "Waiting 7m", warn: false });
    expect(speedToLead("2026-10-11T04:50:00.000Z", null, now)).toMatchObject({ state: "waiting", label: "Waiting 22m", warn: true });
  });
  it("shows how fast a contacted lead was reached, and whether it beat the target", () => {
    expect(speedToLead("2026-10-11T05:00:00.000Z", "2026-10-11T05:06:00.000Z", now)).toMatchObject({ state: "met", label: "Reached in 6m", warn: false });
    expect(speedToLead("2026-10-11T04:00:00.000Z", "2026-10-11T05:00:00.000Z", now)).toMatchObject({ state: "late", label: "Reached in 1h", warn: false });
  });
  it("never goes negative on a clock skew", () => {
    expect(speedToLead("2026-10-11T05:30:00.000Z", null, now).label).toBe("Waiting 0m");
  });
});

describe("formatWait", () => {
  it("reads minutes, hours, days", () => {
    expect(formatWait(0)).toBe("0m");
    expect(formatWait(59)).toBe("59m");
    expect(formatWait(60)).toBe("1h");
    expect(formatWait(185)).toBe("3h");
    expect(formatWait(60 * 24 * 2 + 5)).toBe("2d");
  });
});

describe("announcements", () => {
  it("say where a card is and how to move it, for a screen reader", () => {
    expect(announceLift("Riya", "New Lead", 1, 4)).toBe("Picked up Riya, in New Lead, position 1 of 4. Use the left and right arrow keys to choose a stage, Space to drop, Escape to cancel.");
    expect(announceDrop("Riya", "Submitted for KYC")).toBe("Riya moved to Submitted for KYC.");
  });
});
