/**
 * The ONE gate for the campaign planner (and every other marketing screen): only ADMIN and MARKETING pass.
 * Takes a plain string so it works before the MARKETING value exists in the Role enum on every branch.
 */
export function canAccessMarketing(role: string): boolean {
  return role === "ADMIN" || role === "MARKETING";
}
