/** Who may see marketing screens, ad spend, campaign cost and ad accounts. Every marketing route, action, API and nav item goes through this one check. */
export function canAccessMarketing(role: string): boolean {
  return role === "ADMIN" || role === "MARKETING";
}
