import { describe, expect, it } from "vitest";

import { EARLY_COUNT_KEY, EARLY_LISTENER_KEY, EARLY_PALETTE_SCRIPT, takeEarlyPaletteOpen } from "./early-open";

// A minimal window: the early script only needs addEventListener/removeEventListener and a place to keep its counter.
function fakeWindow() {
  const listeners = new Set<(e: KeyboardEvent) => void>();
  const win: Record<string, unknown> & {
    addEventListener: (t: string, fn: (e: KeyboardEvent) => void) => void;
    removeEventListener: (t: string, fn: (e: KeyboardEvent) => void) => void;
    press: (key: string, mods?: { metaKey?: boolean; ctrlKey?: boolean }) => { defaultPrevented: boolean };
  } = {
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    press(key, mods = {}) {
      const event = { key, metaKey: !!mods.metaKey, ctrlKey: !!mods.ctrlKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      listeners.forEach((fn) => fn(event as unknown as KeyboardEvent));
      return { defaultPrevented: event.defaultPrevented };
    },
  };
  return win;
}

const runEarly = (win: object) => new Function("window", EARLY_PALETTE_SCRIPT)(win);

describe("early Cmd+K queue (before the palette mounts)", () => {
  it("counts a Cmd+K or Ctrl+K press made before the palette is ready, and swallows it", () => {
    const win = fakeWindow();
    runEarly(win);
    expect(win.press("k", { metaKey: true }).defaultPrevented).toBe(true);
    win.press("K", { ctrlKey: true });
    expect(win[EARLY_COUNT_KEY]).toBe(2);
  });

  it("ignores other keys and a plain k", () => {
    const win = fakeWindow();
    runEarly(win);
    expect(win.press("k").defaultPrevented).toBe(false);
    win.press("j", { metaKey: true });
    expect(win[EARLY_COUNT_KEY]).toBe(0);
  });

  it("opens once for an odd number of early presses and detaches the listener on mount", () => {
    const win = fakeWindow();
    runEarly(win);
    win.press("k", { metaKey: true });
    expect(takeEarlyPaletteOpen(win as never)).toBe(true);
    expect(win[EARLY_LISTENER_KEY]).toBeUndefined();
    expect(win[EARLY_COUNT_KEY]).toBeUndefined();
    win.press("k", { metaKey: true });
    expect(win[EARLY_COUNT_KEY]).toBeUndefined();
  });

  it("does not open for an even number of presses, and does nothing when nothing was queued", () => {
    const win = fakeWindow();
    runEarly(win);
    win.press("k", { metaKey: true });
    win.press("k", { metaKey: true });
    expect(takeEarlyPaletteOpen(win as never)).toBe(false);
    expect(takeEarlyPaletteOpen(undefined)).toBe(false);
    expect(takeEarlyPaletteOpen(fakeWindow() as never)).toBe(false);
  });

  it("a second copy of the script does not attach a second listener", () => {
    const win = fakeWindow();
    runEarly(win);
    runEarly(win);
    win.press("k", { metaKey: true });
    expect(win[EARLY_COUNT_KEY]).toBe(1);
  });
});
