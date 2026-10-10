import type { NavCategoryKey, NavItem } from "@/lib/nav-items";

/** The sidebar's sections: small uppercase label, then its items. Pure, so the grouping is tested without a DOM. */
export type NavSection = { key: NavCategoryKey | "overview"; items: NavItem[] };

/**
 * Items keep NAV_ITEMS order; a section is emitted where its first item appears. Items without a category (Dashboard, the
 * single-role home pages) share the Overview section, which sits where the first of them was.
 */
export function buildSections(items: readonly NavItem[]): NavSection[] {
  const sections: NavSection[] = [];
  const byKey = new Map<string, NavSection>();
  for (const item of items) {
    const key = item.category ?? "overview";
    let s = byKey.get(key);
    if (!s) {
      s = { key, items: [] };
      byKey.set(key, s);
      sections.push(s);
    }
    s.items.push(item);
  }
  return sections;
}

/** "99+" past two digits, nothing for zero: the badge never grows wider than the rail allows. */
export function badgeText(n: number | undefined): string | null {
  if (!n || n < 1) return null;
  return n > 99 ? "99+" : String(n);
}

/** "ADMIN" -> "Admin", "TEAM_MANAGER" -> "Team manager". */
export function roleLabel(role: string): string {
  const words = role.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Sections that start tucked away: the admin and reference lists are long and rarely needed day to day. The five working sections are always open until a person closes one. */
const COLLAPSED_BY_DEFAULT = new Set<string>(["administration", "reference"]);

/**
 * Which sections are open. A person's own choice (remembered per person) wins; otherwise the working sections are open, the
 * long admin and help lists are closed, and the section holding the current page is always revealed.
 */
export function resolveOpen(sections: readonly NavSection[], remembered: Readonly<Record<string, boolean>>, isActive: (href: string) => boolean): Set<string> {
  const open = new Set<string>();
  for (const s of sections) {
    const choice = remembered[s.key];
    const base = choice ?? !COLLAPSED_BY_DEFAULT.has(s.key);
    if (base || s.items.some((i) => isActive(i.href))) open.add(s.key);
  }
  open.add("overview");
  return open;
}

/** The one nav item the current path belongs to: the longest href that is the path or a parent of it ("/partners/payouts" is Payouts, not Workspace). */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const h of hrefs) {
    if (pathname === h || pathname.startsWith(h + "/")) if (!best || h.length > best.length) best = h;
  }
  return best;
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
