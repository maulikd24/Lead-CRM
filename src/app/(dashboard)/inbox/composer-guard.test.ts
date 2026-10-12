import { describe, expect, it } from "vitest";
import { enterMaySend, ENTER_AFTER_USE_MS } from "./composer-guard";

const base = { repeat: false, isComposing: false, shiftKey: false, msSinceUse: null as number | null };
describe("enterMaySend", () => {
  it("allows a plain Enter", () => expect(enterMaySend(base)).toBe(true));
  it("ignores auto-repeat (a held Enter must not send)", () => expect(enterMaySend({ ...base, repeat: true })).toBe(false));
  it("ignores Enter during IME composition", () => expect(enterMaySend({ ...base, isComposing: true })).toBe(false));
  it("Shift+Enter is a newline, not a send", () => expect(enterMaySend({ ...base, shiftKey: true })).toBe(false));
  it("ignores Enter within 400 ms of Use moving focus into the composer", () => {
    expect(ENTER_AFTER_USE_MS).toBe(400);
    expect(enterMaySend({ ...base, msSinceUse: 100 })).toBe(false);
    expect(enterMaySend({ ...base, msSinceUse: 400 })).toBe(true);
    expect(enterMaySend({ ...base, msSinceUse: 5000 })).toBe(true);
  });
});
