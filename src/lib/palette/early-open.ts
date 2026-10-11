/**
 * Cmd+K / Ctrl+K before the page has hydrated. The palette's own keyboard listener is attached in an effect, so a press made while the
 * JavaScript is still loading used to do nothing. A tiny inline script in the root layout runs as the HTML is parsed, counts those
 * presses on `window`, and the palette opens once if the count is odd (a single press). The palette takes over the moment it mounts
 * and detaches the early listener. Nothing here decides what a role may see: the palette still lists only what the role may open.
 */

export const EARLY_COUNT_KEY = "__allvestPaletteEarly";
export const EARLY_LISTENER_KEY = "__allvestPaletteEarlyListener";

type EarlyWindow = {
  addEventListener: (type: "keydown", fn: (e: KeyboardEvent) => void, capture?: boolean) => void;
  removeEventListener: (type: "keydown", fn: (e: KeyboardEvent) => void, capture?: boolean) => void;
} & Record<string, unknown>;

/** Runs before hydration (inline in the root layout). Idempotent: a second copy does nothing. */
export const EARLY_PALETTE_SCRIPT = `(function(){var w=window;if(w.${EARLY_LISTENER_KEY})return;w.${EARLY_COUNT_KEY}=0;` +
  `var h=function(e){if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==="k"){e.preventDefault();w.${EARLY_COUNT_KEY}++;}};` +
  `w.${EARLY_LISTENER_KEY}=h;w.addEventListener("keydown",h,true);})();`;

/**
 * Called once by the palette on mount. Detaches the early listener and returns true when an odd number of Cmd+K presses arrived
 * before the palette was ready (so the palette should open). Returns false when there was nothing queued.
 */
export function takeEarlyPaletteOpen(win: EarlyWindow | undefined): boolean {
  if (!win) return false;
  const listener = win[EARLY_LISTENER_KEY] as ((e: KeyboardEvent) => void) | undefined;
  if (listener) win.removeEventListener("keydown", listener, true);
  delete win[EARLY_LISTENER_KEY];
  const count = typeof win[EARLY_COUNT_KEY] === "number" ? (win[EARLY_COUNT_KEY] as number) : 0;
  delete win[EARLY_COUNT_KEY];
  return count % 2 === 1;
}
