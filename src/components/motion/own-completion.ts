/** Window event fired by the signed-in user's own successful action (for example, a funding save). */
export const OWN_COMPLETION_EVENT = "allvest:own-completion";

export type OwnCompletionDetail = { id: string; actorUserId: string };

/** Called only from the user's own action. Listeners decide whether it is theirs and celebrate at most once. */
export function announceOwnCompletion(detail: OwnCompletionDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OwnCompletionDetail>(OWN_COMPLETION_EVENT, { detail }));
}
