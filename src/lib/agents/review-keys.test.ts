import { describe, expect, it } from "vitest";

import { reviewKey, type KeyCtx } from "./review-keys";

const ctx: KeyCtx = { typing: false, canAct: true, busy: false };
const press = (key: string, armed: "approve" | "reject" | null = null, c: Partial<KeyCtx> = {}, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {}) => reviewKey(key, mods, armed, { ...ctx, ...c });

describe("reviewKey: moving", () => {
  it("j and ArrowDown go to the next draft, k and ArrowUp to the previous", () => {
    expect(press("j").intent).toEqual({ kind: "move", delta: 1 });
    expect(press("ArrowDown").intent).toEqual({ kind: "move", delta: 1 });
    expect(press("k").intent).toEqual({ kind: "move", delta: -1 });
    expect(press("ArrowUp").intent).toEqual({ kind: "move", delta: -1 });
  });
  it("moving disarms", () => {
    expect(press("j", "approve").armed).toBeNull();
  });
  it("a viewer who cannot act can still move", () => {
    expect(press("j", null, { canAct: false }).intent.kind).toBe("move");
  });
});

describe("reviewKey: two-step approve and reject (nothing is sent by one stray key)", () => {
  it("first A arms approval, a second A (or Enter) sends it", () => {
    const first = press("a");
    expect(first).toEqual({ armed: "approve", intent: { kind: "arm", action: "approve" } });
    expect(press("a", "approve")).toEqual({ armed: null, intent: { kind: "run", action: "approve" } });
    expect(press("Enter", "approve")).toEqual({ armed: null, intent: { kind: "run", action: "approve" } });
  });
  it("R works the same way for reject", () => {
    expect(press("r").armed).toBe("reject");
    expect(press("r", "reject").intent).toEqual({ kind: "run", action: "reject" });
  });
  it("pressing the other action while armed switches the arming, it never runs", () => {
    expect(press("r", "approve")).toEqual({ armed: "reject", intent: { kind: "arm", action: "reject" } });
  });
  it("Enter with nothing armed does nothing", () => {
    expect(press("Enter").intent).toEqual({ kind: "none" });
  });
  it("Escape cancels", () => {
    expect(press("Escape", "approve")).toEqual({ armed: null, intent: { kind: "disarm" } });
  });
  it("any other key cancels", () => {
    expect(press("x", "approve").armed).toBeNull();
  });
  it("cannot arm or run while busy or when the viewer cannot act", () => {
    expect(press("a", null, { busy: true }).intent.kind).toBe("none");
    expect(press("a", "approve", { busy: true }).intent.kind).toBe("none");
    expect(press("a", null, { canAct: false }).intent.kind).toBe("none");
    expect(press("r", null, { canAct: false }).intent.kind).toBe("none");
  });
  it("E moves focus to the message editor", () => {
    expect(press("e").intent).toEqual({ kind: "edit" });
  });
});

describe("reviewKey: typing and modifiers", () => {
  it("plain letters are ignored while typing in the editor", () => {
    for (const k of ["a", "r", "j", "k", "e"]) expect(press(k, null, { typing: true })).toEqual({ armed: null, intent: { kind: "none" } });
  });
  it("Ctrl or Cmd with Enter arms, then sends, even from the editor", () => {
    expect(press("Enter", null, { typing: true }, { ctrl: true })).toEqual({ armed: "approve", intent: { kind: "arm", action: "approve" } });
    expect(press("Enter", "approve", { typing: true }, { meta: true })).toEqual({ armed: null, intent: { kind: "run", action: "approve" } });
  });
  it("Escape in the editor cancels any arming and leaves the field", () => {
    expect(press("Escape", "approve", { typing: true }).intent).toEqual({ kind: "blur" });
  });
  it("browser shortcuts (Ctrl+R, Cmd+A) are never hijacked", () => {
    expect(press("r", null, {}, { ctrl: true }).intent.kind).toBe("none");
    expect(press("a", null, {}, { meta: true }).intent.kind).toBe("none");
    expect(press("j", null, {}, { alt: true }).intent.kind).toBe("none");
  });
});
