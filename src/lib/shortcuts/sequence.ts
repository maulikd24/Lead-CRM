/**
 * The global shortcut matcher, kept pure so it can be tested without a DOM. Single keys (`c`, `/`, `?`) fire at once; `g` starts a
 * two-key sequence that must finish within SEQUENCE_WINDOW_MS. Nothing fires while the person is typing, or with Cmd/Ctrl/Alt held
 * (those belong to the browser and to Cmd+K).
 */
export const SEQUENCE_WINDOW_MS = 1000;

export type KeyLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
export type TargetLike = { tagName?: string; isContentEditable?: boolean; getAttribute?: (name: string) => string | null } | null;
export type SequenceState = { pending: "g" | null; at: number };

export const IDLE: SequenceState = { pending: null, at: 0 };

const SINGLE = new Set(["c", "/", "?"]);

export function isTypingTarget(target: TargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const role = target.getAttribute?.("role");
  return role === "textbox" || role === "combobox";
}

/** Feed one keydown; returns the next state and the shortcut it completed ("c", "/", "?", or "g x"), if any. */
export function step(state: SequenceState, event: KeyLike, now: number): { state: SequenceState; match: string | null } {
  if (event.metaKey || event.ctrlKey || event.altKey) return { state: IDLE, match: null };
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (state.pending === "g" && now - state.at <= SEQUENCE_WINDOW_MS && /^[a-z]$/.test(key)) {
    return { state: IDLE, match: `g ${key}` };
  }
  if (key === "g") return { state: { pending: "g", at: now }, match: null };
  if (SINGLE.has(key)) return { state: IDLE, match: key };
  return { state: IDLE, match: null };
}
