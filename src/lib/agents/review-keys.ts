/**
 * Keyboard model for reviewing agent drafts. Pure, so it is tested without a browser.
 *
 * Approving sends a real message to a customer, so a single stray key must never do it: A (or R) first ARMS the action, and the
 * same key again, or Enter, runs it. Escape or any other key disarms. While typing in the message editor only Ctrl/Cmd+Enter
 * (arm, then send) and Escape work, so editing is never interrupted.
 */
export type Armed = "approve" | "reject" | null;
export type KeyCtx = { typing: boolean; canAct: boolean; busy: boolean };
export type Intent =
  | { kind: "none" }
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "arm"; action: "approve" | "reject" }
  | { kind: "run"; action: "approve" | "reject" }
  | { kind: "disarm" }
  | { kind: "edit" }
  | { kind: "blur" };

const none = (armed: Armed) => ({ armed, intent: { kind: "none" } as Intent });

export function reviewKey(key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean }, armed: Armed, ctx: KeyCtx): { armed: Armed; intent: Intent } {
  const accel = !!(mods.meta || mods.ctrl);
  const k = key.length === 1 ? key.toLowerCase() : key;

  if (ctx.typing) {
    if (k === "Escape") return { armed: null, intent: { kind: "blur" } };
    if (k === "Enter" && accel && ctx.canAct && !ctx.busy) return step("approve", armed);
    return none(armed);
  }
  if (mods.alt || accel) return none(armed); // never hijack browser shortcuts (Ctrl+R, Cmd+A...)

  if (k === "j" || k === "ArrowDown") return { armed: null, intent: { kind: "move", delta: 1 } };
  if (k === "k" || k === "ArrowUp") return { armed: null, intent: { kind: "move", delta: -1 } };
  if (k === "Escape") return { armed: null, intent: { kind: "disarm" } };
  if (!ctx.canAct || ctx.busy) return none(armed);
  if (k === "e") return { armed: null, intent: { kind: "edit" } };
  if (k === "a") return step("approve", armed);
  if (k === "r") return step("reject", armed);
  if (k === "Enter") return armed ? { armed: null, intent: { kind: "run", action: armed } } : none(armed);
  return { armed: null, intent: { kind: "none" } };
}

function step(action: "approve" | "reject", armed: Armed): { armed: Armed; intent: Intent } {
  return armed === action ? { armed: null, intent: { kind: "run", action } } : { armed: action, intent: { kind: "arm", action } };
}
