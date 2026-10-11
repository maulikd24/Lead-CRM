/** Who may use the marketing growth modules (creative intelligence, ad copy drafts, competitor ads, experiments, director reports, the weekly digest): ADMIN and MARKETING only. */
export function canAccessMarketing(role: string): boolean {
  return role === "ADMIN" || role === "MARKETING";
}
