/**
 * Who may see ad cost and return: spend, cost per lead, ROAS, budgets, Campaign impact and Lead leakage.
 * Only ADMIN and MARKETING. Everyone else (RMs included) sees a customer's campaign name, source, creative and
 * journey steps, never a cost figure. Takes a plain string so an unknown or future role is refused, not guessed.
 */
export function canAccessMarketing(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "MARKETING";
}

/** MARKETING sees customer lists without names, relationship managers or links into the CRM. */
export function isPseudonymousViewer(role: string | null | undefined): boolean {
  return role === "MARKETING";
}
