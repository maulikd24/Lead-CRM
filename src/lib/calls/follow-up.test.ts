import { describe, expect, it } from "vitest";
import { buildFollowUpTask, followUpSource, validateReviewNote } from "./follow-up";

const NOW = new Date("2026-10-09T10:00:00Z");

describe("buildFollowUpTask", () => {
  it("uses the typed title, trimmed, and a due date N days out", () => {
    const t = buildFollowUpTask({ title: "  Send the statement  ", recommendation: "ignored", customerName: "Riya Shah", dueInDays: 2, now: NOW });
    expect(t.title).toBe("Send the statement");
    expect(t.dueAt.toISOString()).toBe("2026-10-11T10:00:00.000Z");
  });
  it("falls back to the AI recommendation, then a generic line with the customer name", () => {
    expect(buildFollowUpTask({ title: "", recommendation: "Share lock-in explainer", customerName: "Riya Shah", now: NOW }).title).toBe("Share lock-in explainer");
    expect(buildFollowUpTask({ title: "", recommendation: null, customerName: "Riya Shah", now: NOW }).title).toBe("Follow up with Riya Shah after call");
  });
  it("clamps the due window to 1-14 days and the title to 200 characters", () => {
    expect(buildFollowUpTask({ title: "x", recommendation: null, customerName: "A", dueInDays: 0, now: NOW }).dueAt.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(buildFollowUpTask({ title: "x", recommendation: null, customerName: "A", dueInDays: 99, now: NOW }).dueAt.toISOString()).toBe("2026-10-23T10:00:00.000Z");
    expect(buildFollowUpTask({ title: "y".repeat(500), recommendation: null, customerName: "A", now: NOW }).title).toHaveLength(200);
  });
  it("masks sensitive text in a recommendation used as the title", () => {
    const t = buildFollowUpTask({ title: "", recommendation: "Call back on 9876543210 about ABCDE1234F", customerName: "A", now: NOW });
    expect(t.title).not.toMatch(/9876543210|ABCDE1234F/);
  });
  it("defaults to tomorrow", () => {
    expect(buildFollowUpTask({ title: "x", recommendation: null, customerName: "A", now: NOW }).dueAt.toISOString()).toBe("2026-10-10T10:00:00.000Z");
  });
});

describe("followUpSource", () => {
  it("is stable per call so a double click cannot create two open tasks", () => {
    expect(followUpSource("a1")).toBe("calls-review:a1");
  });
});

describe("validateReviewNote", () => {
  it("trims, allows empty, and rejects over-long notes", () => {
    expect(validateReviewNote("  ok  ")).toEqual({ ok: true, note: "ok" });
    expect(validateReviewNote("")).toEqual({ ok: true, note: null });
    expect(validateReviewNote(null)).toEqual({ ok: true, note: null });
    expect(validateReviewNote("z".repeat(2001)).ok).toBe(false);
  });
});
