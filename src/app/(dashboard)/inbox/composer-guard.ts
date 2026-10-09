/** After "Use" moves focus into the composer, a held or immediate Enter must not send an unreviewed AI draft. */
export const ENTER_AFTER_USE_MS = 400;

export function enterMaySend(input: { repeat: boolean; isComposing: boolean; shiftKey: boolean; msSinceUse: number | null }): boolean {
  if (input.repeat || input.isComposing || input.shiftKey) return false;
  return input.msSinceUse === null || input.msSinceUse >= ENTER_AFTER_USE_MS;
}
