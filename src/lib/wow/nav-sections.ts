/** "99+" past two digits, nothing for zero: the badge never grows wider than the rail allows. */
export function badgeText(n: number | undefined): string | null {
  if (!n || n < 1) return null;
  return n > 99 ? "99+" : String(n);
}

/** "ADMIN" -> "Admin", "TEAM_MANAGER" -> "Team manager". */
export function roleLabel(role: string): string {
  if (role === "RM") return "RM";
  const words = role.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Remembered open/closed state, parsed defensively from storage (anything unexpected is ignored). */
export function parseRemembered(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** One key per person, so two people sharing a browser each keep their own layout. */
export function navStateKey(email: string): string {
  return `allvest:navOpen:${email.toLowerCase().replace(/[^a-z0-9@._-]/g, "")}`;
}

/** The cookie that remembers one person's rail choice. Only characters that are safe in a cookie name. */
export function railCookieName(userId: string): string {
  return `sidebar_state_${userId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}
