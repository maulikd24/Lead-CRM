import type { Role } from "@/generated/prisma/client";
import { SPACES, visibleNavItems } from "@/lib/nav-items";
import { landingFor } from "@/lib/policy/workspace";

import { ACTIONS, ALL_ROLES, AREA_KEYS, AREAS, can, type Action, type Area, type AreaGroup } from "./policy";

export type MatrixRow = { area: Area; label: string; group: AreaGroup; cells: Record<Role, Action[]> };
export type Matrix = { roles: Role[]; rows: MatrixRow[] };

/** The role x area grid, generated from the registry and nothing else: the Who can see what page and the matrix test read it. */
export function buildMatrix(): Matrix {
  const rows = AREA_KEYS.map((area) => ({
    area,
    label: AREAS[area].label,
    group: AREAS[area].group,
    cells: Object.fromEntries(ALL_ROLES.map((role) => [role, ACTIONS.filter((a) => can(role, area, a))])) as Record<Role, Action[]>,
  }));
  return { roles: [...ALL_ROLES], rows };
}

const WORD: Record<Action, string> = { view: "View", manage: "change", export: "export" };
export function cellText(actions: readonly Action[]): string {
  if (actions.length === 0) return "None";
  return actions.map((a) => WORD[a]).join(", ");
}

export type Preview = { role: Role; landing: string; sidebar: { href: string; label: string; category: string }[]; areas: { area: Area; label: string; actions: Action[] }[] };

/** What a role sees: the sidebar (with the feature flags that are on) and the page it lands on. Plain data; reading it changes nothing. */
export function previewFor(role: Role, flags: readonly string[]): Preview {
  return {
    role,
    landing: landingFor(role),
    sidebar: visibleNavItems(role, flags).map((i) => ({ href: i.href, label: i.label, category: SPACES[i.roleSpace?.[role] ?? i.space].label })),
    areas: AREA_KEYS.map((area) => ({ area, label: AREAS[area].label, actions: ACTIONS.filter((a) => can(role, area, a)) })).filter((a) => a.actions.length > 0),
  };
}
