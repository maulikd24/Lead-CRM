import { previewFor } from "@/lib/access/matrix";
import { can, type Area } from "@/lib/access/policy";
import { NAV_FLAGS } from "@/lib/nav-flags";

export type TourKey = "rm" | "marketing" | "management" | "admin" | "control-plane";

/** The role tours shown on the front door. Management is the MANAGER role; the control plane is an Admin view. */
export const TOUR_ROLES: { key: TourKey; label: string; role: "RM" | "MARKETING" | "MANAGER" | "ADMIN" }[] = [
  { key: "rm", label: "RM", role: "RM" },
  { key: "marketing", label: "Marketing", role: "MARKETING" },
  { key: "management", label: "Management", role: "MANAGER" },
  { key: "admin", label: "Admin", role: "ADMIN" },
  { key: "control-plane", label: "Control plane", role: "ADMIN" },
];

const roleOf = (key: TourKey) => TOUR_ROLES.find((r) => r.key === key)!.role;

/** The real sidebar of a role (with every nav feature on, as the finished product), grouped by section. Read from the registry, not typed here. */
export function sidebarFor(key: TourKey): { group: string; items: string[] }[] {
  const preview = previewFor(roleOf(key), Object.keys(NAV_FLAGS));
  const groups: { group: string; items: string[] }[] = [];
  for (const item of preview.sidebar) {
    const group = item.category ?? "Main";
    let g = groups.find((x) => x.group === group);
    if (!g) groups.push((g = { group, items: [] }));
    g.items.push(item.label);
  }
  return groups;
}

const PROBES: { label: string; area: Area }[] = [
  { label: "Customer names and records", area: "clients" },
  { label: "Inbox and calls", area: "inbox" },
  { label: "Ad spend and campaigns", area: "marketing" },
  { label: "Team reports", area: "reports" },
  { label: "Users and roles", area: "settings-users" },
];

/** "Can this role open it?" answered by the live default-deny registry, so the page cannot drift from the product. */
export function probesFor(key: TourKey): { label: string; area: Area; allowed: boolean }[] {
  const role = roleOf(key);
  return PROBES.map((p) => ({ ...p, allowed: can(role, p.area, "view") }));
}
