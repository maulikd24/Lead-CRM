/** Who may use the marketing and closed-loop screens, actions, APIs and nav items. One rule, one place. */
export function canAccessMarketing(role: string): boolean {
  return role === "ADMIN" || role === "MARKETING";
}
