/** Pure rules behind the Duplicate review screen: the keyboard map, what Skip does, and when "Ask a manager" is offered. */

export type ReviewAction = "next" | "prev" | "keep-first" | "keep-second" | "merge" | "skip" | "dismiss";

const KEYS: Record<string, ReviewAction> = { j: "next", k: "prev", "1": "keep-first", "2": "keep-second", m: "merge", s: "skip", d: "dismiss" };

type KeyEventLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

/** The action a key press means, or null. Shortcuts with a modifier belong to the browser, so they are never ours. */
export function reviewKeyAction(e: KeyEventLike): ReviewAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return KEYS[e.key] ?? null;
}

/** Skip leaves the suggestion open and moves on to the next one, wrapping to the first after the last. Null when there is nowhere to go. */
export function skipTarget(index: number, length: number): number | null {
  if (length <= 1) return null;
  return (Math.max(index, 0) + 1) % length;
}

/**
 * "Ask a manager" is for a relationship manager looking at a pair that spans another owner: they cannot merge it, a manager
 * can. Admins and managers decide directly, so they are never offered it.
 */
export function canAskManager(role: string, crossRm: boolean): boolean {
  return role === "RM" && crossRm;
}
