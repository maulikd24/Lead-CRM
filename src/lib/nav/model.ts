import { can } from "@/lib/access/policy";
import { GROUP_ORDER, NAV_ITEMS, SPACES, SPACE_ORDER, navItemEnabled, type NavItem, type SpaceKey } from "@/lib/nav-items";
import type { Role } from "@/generated/prisma/client";

export type { SpaceKey } from "@/lib/nav-items";

/** Active: open it. Off: its flag is off (ADMIN sees it greyed). Setup: its flag is on but something is missing (ADMIN sees it greyed). */
export type NavState = "active" | "off" | "setup";

export type NavEntry = NavItem & {
  state: NavState;
  /** Why a greyed item is greyed, in plain words (ADMIN only). */
  stateNote?: string;
  /** The workspace this entry sits in FOR THIS ROLE (an item's `roleSpace` may move it). */
  space: SpaceKey;
};

const FLAG_LABEL: Record<string, string> = {
  "partner-workspace": "Partner workspace",
  "calls-review": "Call recordings",
  "merge-review": "Duplicate review",
  "support-sla": "Support SLA",
  marketing: "Marketing",
  "backoffice-import": "Back-office import",
  "referral-program": "Referral programme",
  "control-plane": "Control plane",
  "approvals-inbox": "Approvals inbox",
  "service-state": "Complaints and commitments",
  "product-registry": "Product registry",
  "attention-engine": "Attention engine",
  "decision-drawer": "Decision shadow report",
  insights: "Agent insights",
  outcomes: "Goals and outcomes",
  attribution: "Attribution",
  "google-signin": "Google sign-in",
};

/**
 * Every entry this role may see, in NAV_ITEMS order. The ONE rule: the role must be listed AND the central policy registry must allow
 * the area (default deny). A flag that is off hides the item from everyone except ADMIN, who sees it greyed with its state, so nothing
 * is hidden from the person who can switch it on. A role never gets an entry for something the registry refuses it, so a greyed item
 * can never leak that a module exists to a role that cannot reach it.
 */
export function navEntriesFor(role: Role, enabledFlags: readonly string[], opts: { setupNeeded?: readonly string[] } = {}): NavEntry[] {
  const out: NavEntry[] = [];
  for (const item of NAV_ITEMS) {
    if (!item.roles.includes(role) || !can(role, item.area, "view")) continue;
    const space = item.roleSpace?.[role] ?? item.space;
    if (navItemEnabled(item, enabledFlags)) {
      const needsSetup = role === "ADMIN" && item.flag !== undefined && (opts.setupNeeded ?? []).includes(item.flag);
      out.push({ ...item, space, state: needsSetup ? "setup" : "active", stateNote: needsSetup ? "Switched on, needs setup" : undefined });
    } else if (role === "ADMIN") {
      out.push({ ...item, space, state: "off", stateNote: `Off: ${FLAG_LABEL[item.flag ?? ""] ?? "this module"} is not switched on` });
    }
  }
  return out;
}

export type RailEntry = { space: SpaceKey; label: string; count: number };

/** The rail: every on-rail workspace that has at least one entry for this role, in the fixed order. A workspace with nothing for the role is not shown. */
export function railFor(entries: readonly NavEntry[]): RailEntry[] {
  return SPACE_ORDER.filter((s) => SPACES[s].onRail)
    .map((space) => ({ space, label: SPACES[space].label, count: panelEntries(entries, space).length }))
    .filter((r) => r.count > 0);
}

/** A workspace's entries: its own, plus the ones listed `alsoIn` it, but only where the role has entries of its own there (a role never gets a workspace just from an also-listing). */
function panelEntries(entries: readonly NavEntry[], space: SpaceKey): NavEntry[] {
  const own = entries.filter((e) => e.space === space);
  if (own.length === 0) return [];
  return entries.filter((e) => e.space === space || e.alsoIn?.includes(space));
}

function orderGroups(space: SpaceKey, groups: NavGroup[]): NavGroup[] {
  const order = GROUP_ORDER[space] ?? [];
  const rank = (g: string) => (order.includes(g) ? order.indexOf(g) : order.length);
  return [...groups].sort((a, b) => rank(a.group) - rank(b.group)); // stable: unknown groups keep their first-appearance order
}

export type NavGroup = { group: string; entries: NavEntry[] };

/** One workspace's panel: its entries grouped by `group`, groups in order of first appearance. */
export function panelFor(entries: readonly NavEntry[], space: SpaceKey): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const e of panelEntries(entries, space)) {
    let g = groups.find((x) => x.group === e.group);
    if (!g) groups.push((g = { group: e.group, entries: [] }));
    g.entries.push(e);
  }
  return orderGroups(space, groups);
}

export type ModuleSpace = { space: SpaceKey; label: string; groups: NavGroup[] };

/** The All modules directory: every entry once, under its own workspace, with its state. */
export function allModules(entries: readonly NavEntry[]): ModuleSpace[] {
  return SPACE_ORDER.map((space) => {
    const groups: NavGroup[] = [];
    for (const e of entries.filter((x) => x.space === space)) {
      let g = groups.find((x) => x.group === e.group);
      if (!g) groups.push((g = { group: e.group, entries: [] }));
      g.entries.push(e);
    }
    return { space, label: SPACES[space].label, groups: orderGroups(space, groups) };
  }).filter((s) => s.groups.length > 0);
}

/** Where a workspace's rail icon leads: its first active entry, else its first entry. */
export function spaceHome(entries: readonly NavEntry[], space: SpaceKey): string | null {
  const list = panelEntries(entries, space);
  const own = list.filter((e) => e.space === space); // an also-listed item must not become the workspace's front door
  return (own.find((e) => e.state === "active") ?? own[0] ?? list[0])?.href ?? null;
}

/** The workspace the current page belongs to (for the rail highlight), preferring the entry's own workspace over an `alsoIn` listing. */
export function spaceOfEntry(entries: readonly NavEntry[], href: string | null): SpaceKey | null {
  return entries.find((e) => e.href === href)?.space ?? null;
}

/**
 * The one nav entry the current page belongs to: the longest matching path, and among equal paths the one whose named query
 * parameters all match the current URL ("/dashboard?tab=attention" wins over "/dashboard" only on that tab).
 */
export function activeNavEntry(pathname: string, search: string, hrefs: readonly string[]): string | null {
  const current = new URLSearchParams(search);
  let best: { href: string; score: number } | null = null;
  for (const href of hrefs) {
    const [path, query = ""] = href.split("?");
    if (!(pathname === path || pathname.startsWith(`${path}/`))) continue;
    const want = new URLSearchParams(query);
    let ok = true;
    for (const [k, v] of want) if (current.get(k) !== v) ok = false;
    if (!ok) continue;
    const score = path.length * 10 + [...want].length;
    if (!best || score > best.score) best = { href, score };
  }
  return best?.href ?? null;
}
