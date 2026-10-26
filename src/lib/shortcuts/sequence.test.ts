import { describe, expect, it } from "vitest";

import { IDLE, SEQUENCE_WINDOW_MS, isTypingTarget, step } from "./sequence";

const run = (keys: { key: string; at: number; meta?: boolean }[]) => {
  let state = IDLE;
  const matches: string[] = [];
  for (const k of keys) {
    const r = step(state, { key: k.key, metaKey: k.meta }, k.at);
    state = r.state;
    if (r.match) matches.push(r.match);
  }
  return matches;
};

describe("shortcut sequence matcher", () => {
  it("fires single keys at once", () => expect(run([{ key: "c", at: 0 }, { key: "/", at: 1 }, { key: "?", at: 2 }])).toEqual(["c", "/", "?"]));
  it("completes g then a letter within the window", () => expect(run([{ key: "g", at: 0 }, { key: "C", at: 400 }])).toEqual(["g c"]));
  it("drops a g sequence that took too long, and treats the late key on its own", () => {
    expect(run([{ key: "g", at: 0 }, { key: "c", at: SEQUENCE_WINDOW_MS + 1 }])).toEqual(["c"]);
  });
  it("ignores keys with Cmd/Ctrl/Alt held, and resets a pending g", () => {
    expect(run([{ key: "c", at: 0, meta: true }])).toEqual([]);
    expect(run([{ key: "g", at: 0 }, { key: "k", at: 10, meta: true }, { key: "h", at: 20 }])).toEqual([]);
  });
  it("ignores unrelated keys", () => expect(run([{ key: "x", at: 0 }, { key: "Enter", at: 1 }])).toEqual([]));
  it("knows when the person is typing", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", getAttribute: (n) => (n === "role" ? "combobox" : null) })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", getAttribute: () => null })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
