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

/** Which sections start open: the one holding the current page, plus Overview. Everything else stays closed until asked for. */
export function initialOpen(sections: readonly NavSection[], isActive: (href: string) => boolean): Set<string> {
  const open = new Set<string>(["overview"]);
  for (const s of sections) if (s.items.some((i) => isActive(i.href))) open.add(s.key);
  return open;
}

/** The cookie that remembers one person's rail choice. Only characters that are safe in a cookie name. */
export function railCookieName(userId: string): string {
  return `sidebar_state_${userId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}
