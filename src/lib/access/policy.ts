import type { Role } from "@/generated/prisma/client";

/**
 * THE permission registry. One typed table: area x action x role, default DENY.
 *
 * Everything that decides "may this person see or do this" asks it: the sidebar and Cmd+K (nav-items), every page and
 * server action (`requireAccess`), API routes, exports, cron/job outputs, Cmd+K search results, Ask and Co-pilot scopes,
 * notifications, shareable report links and data loaders (see surfaces.ts and surface-policy.ts for the inventories).
 *
 * Rules that cannot be bent:
 * - Default deny. An area, or an action on an area, that is not written here is refused for every role (ADMIN included).
 *   A test enumerates every route, server action and API route and fails when one has no declared policy.
 * - ADMIN is a superuser: it holds every action on every declared area, so it is never listed in the table.
 * - Segregation. Marketing and customer work do not overlap: a marketing role never appears on a customer area, and an
 *   RM, manager or finance role never appears on a marketing area. The access-segregation test pins this.
 * - To give a role something, edit this file and nothing else. The matrix page and the matrix test are generated from it.
 */

export type Action = "view" | "manage" | "export";
export const ACTIONS: readonly Action[] = ["view", "manage", "export"];

/** Roles that hold an action, besides ADMIN (who holds every action on every declared area). */
type Grants = Partial<Record<Action, readonly Role[]>>;

const DESK: readonly Role[] = ["MANAGER", "RM"];
const MANAGERS: readonly Role[] = ["MANAGER"];
const MARKETING_ONLY: readonly Role[] = ["MARKETING"];
const PARTNER_USERS: readonly Role[] = ["PARTNER", "AFFILIATE", "DISTRIBUTOR"];
/** Every signed-in role, for the few areas about the person themselves (own account, help). */
const EVERYONE: readonly Role[] = ["MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "MARKETING"];

export type AreaGroup = "customer" | "marketing" | "distribution" | "finance" | "admin" | "self";

export const AREAS = {
  // ---- Customer and sales work: RMs and their managers. Never marketing. -------------------------------------------
  clients: { group: "customer", label: "Clients and leads", view: DESK, manage: DESK, export: DESK },
  "client-360": { group: "customer", label: "Customer 360", view: DESK, manage: DESK },
  "client-consent": { group: "customer", label: "Customer consent capture", view: DESK, manage: DESK },
  "client-support": { group: "customer", label: "Support for own customers", view: DESK, manage: DESK },
  duplicates: { group: "customer", label: "Duplicate customers", view: DESK, manage: DESK },
  households: { group: "customer", label: "Households", view: MANAGERS, manage: MANAGERS },
  inbox: { group: "customer", label: "Inbox and messages", view: DESK, manage: DESK },
  copilot: { group: "customer", label: "Co-pilot", view: DESK, manage: DESK },
  "agent-drafts": { group: "customer", label: "Agent drafts", view: DESK, manage: DESK },
  "agent-insights": { group: "customer", label: "Agent insights", view: MANAGERS },
  calls: { group: "customer", label: "Calls", view: DESK, manage: DESK },
  "quality-audit": { group: "customer", label: "Quality audit", view: DESK, manage: DESK },
  support: { group: "customer", label: "Support SLA", view: MANAGERS, manage: MANAGERS },
  exceptions: { group: "customer", label: "Exceptions", view: MANAGERS },
  journeys: { group: "customer", label: "Journeys", view: MANAGERS, manage: MANAGERS },
  reports: { group: "customer", label: "Sales and team reports", view: MANAGERS, export: MANAGERS },
  "management-dashboard": { group: "customer", label: "Manager dashboard", view: MANAGERS, export: MANAGERS },
  intelligence: { group: "customer", label: "Customer intelligence and Ask", view: MANAGERS, manage: MANAGERS },
  dashboard: { group: "customer", label: "Dashboard and Today", view: DESK },
  outcomes: { group: "customer", label: "Goals and outcomes", view: DESK, manage: DESK },
  "activity-log": { group: "customer", label: "Activity log", view: MANAGERS, export: MANAGERS },
  "feature-specs": { group: "customer", label: "Feature specs", view: MANAGERS },
  /** The campaign name and source label on a lead, for context only. No spend, cost per lead, return, budget or account. */
  "lead-campaign-label": { group: "customer", label: "Campaign label on a lead", view: ["MANAGER", "TEAM_MANAGER", "RM"] },
  /** Own tasks. A marketing hire keeps a task list of their own, with no customer attached. */
  tasks: { group: "self", label: "Tasks", view: [...DESK, "MARKETING"], manage: [...DESK, "MARKETING"] },
  "team-directory": { group: "customer", label: "Team directory (assignable people)", view: MANAGERS, manage: MANAGERS },

  // ---- Marketing: ADMIN and MARKETING only (see marketing-access.ts). Aggregated and pseudonymous data only. ----------
  marketing: { group: "marketing", label: "Marketing workspace (campaigns, reports, digests)", view: MARKETING_ONLY, manage: MARKETING_ONLY, export: MARKETING_ONLY },
  "marketing-creative": { group: "marketing", label: "Creative", view: MARKETING_ONLY, manage: MARKETING_ONLY },
  "marketing-social": { group: "marketing", label: "Social drafts and posts", view: MARKETING_ONLY, manage: MARKETING_ONLY },
  "marketing-competitor-ads": { group: "marketing", label: "Competitor ads", view: MARKETING_ONLY, manage: MARKETING_ONLY },
  "marketing-experiments": { group: "marketing", label: "Experiments", view: MARKETING_ONLY, manage: MARKETING_ONLY },
  "marketing-autopilot": { group: "marketing", label: "Autopilot", view: MARKETING_ONLY, manage: MARKETING_ONLY },
  "marketing-attribution": { group: "marketing", label: "Closed-loop conversions, attribution and campaign impact", view: MARKETING_ONLY, export: MARKETING_ONLY },
  "marketing-reports": { group: "marketing", label: "Director reports and digests", view: MARKETING_ONLY, export: MARKETING_ONLY },
  "marketing-ad-integrations": { group: "marketing", label: "Ad platform cards and reporting settings", view: MARKETING_ONLY, manage: MARKETING_ONLY },
  /** Referral programme at campaign level: rules, funnel, rewards totals. Referrer detail is not part of it. */
  "referral-program": { group: "marketing", label: "Referral programme (rules, funnel, reward totals)", view: ["FINANCE", "MARKETING"], manage: MARKETING_ONLY },
  /** Who the referrers are and their codes: named people, so not part of the campaign-level view. ADMIN manages. */
  "referral-referrers": { group: "finance", label: "Referrers (named people and codes)", view: ["FINANCE"] },
  /** Programme settings and the compliance sign-off of the reward wording. ADMIN only. */
  "referral-settings": { group: "finance", label: "Referral settings and sign-off", view: ["FINANCE"] },

  // ---- Partners and distribution -----------------------------------------------------------------------------------
  "dealer-desk": { group: "distribution", label: "Dealer desk", view: ["DEALER"], manage: ["DEALER"] },
  "partner-home": { group: "distribution", label: "Partner Home (own workspace)", view: PARTNER_USERS },
  "management-console": { group: "distribution", label: "Management Console (team manager)", view: ["TEAM_MANAGER"] },
  "partner-workspace": { group: "distribution", label: "Partner workspace", view: ["FINANCE", "TEAM_MANAGER", ...PARTNER_USERS], export: ["FINANCE", "TEAM_MANAGER", ...PARTNER_USERS] },
  "partner-directory": { group: "distribution", label: "Partner directory and tiers", view: [] },

  // ---- Finance -----------------------------------------------------------------------------------------------------
  "finance-console": { group: "finance", label: "Finance Console", view: ["FINANCE"], manage: ["FINANCE"] },
  earnings: { group: "finance", label: "Earnings", view: ["FINANCE"], manage: ["FINANCE"] },
  "referral-statements": { group: "finance", label: "Referral and partner payout statements", view: ["FINANCE"], manage: ["FINANCE"], export: ["FINANCE"] },
  "partner-finance": { group: "finance", label: "Partner finance settings", view: ["FINANCE"], manage: ["FINANCE"] },
  "erasure-requests": { group: "finance", label: "Erasure requests", view: ["FINANCE"], manage: ["FINANCE"] },

  // ---- Administration: ADMIN only unless noted -----------------------------------------------------------------------
  "settings-users": { group: "admin", label: "Users and roles", view: [] },
  "settings-access": { group: "admin", label: "Who can see what, and View as role", view: [] },
  "settings-integrations": { group: "admin", label: "Apps and integrations", view: [] },
  "settings-stages": { group: "admin", label: "Stages", view: [] },
  "settings-templates": { group: "admin", label: "Templates", view: [] },
  "settings-whatsapp": { group: "admin", label: "WhatsApp accounts", view: [] },
  "settings-approvals": { group: "admin", label: "Approval workflows", view: [] },
  "settings-lead-assignment": { group: "admin", label: "Lead assignment", view: [] },
  "settings-data-privacy": { group: "admin", label: "Data privacy and consent ledger", view: [], export: [] },
  "settings-go-live": { group: "admin", label: "Go-live checklist", view: [], export: [] },
  "settings-system": { group: "admin", label: "System overview and system status", view: [], manage: [] },
  /** Control plane: health, jobs, failures, integrations and alerts. ADMIN only; no other role sees the nav item, the page or any action. */
  "control-plane": { group: "admin", label: "Control plane (health, jobs, failures, integrations)", view: [], manage: [] },
  "settings-ai-pilot": { group: "admin", label: "AI pilot (allowlist and compliance sign-off)", view: [], manage: [] },
  /** The Flags tab on System status: every feature flag, its effective value, rule violations and the profile comparison. Read-only. */
  "settings-flags": { group: "admin", label: "Feature flags and profiles (read-only)", view: [] },
  /** The AI tab on System status: runs by agent and purpose, cost against budget, failure and abstain rates, the agent registry and its kill switches. Admin only; manage = switch an existing kill switch or change an autonomy level. */
  "settings-ai": { group: "admin", label: "AI gateway and agent registry", view: [], manage: [] },
  "settings-backoffice-import": { group: "admin", label: "Back-office import", view: [], manage: [] },
  debugger: { group: "admin", label: "Debugger", view: [], manage: [] },

  // ---- About the signed-in person only ------------------------------------------------------------------------------
  account: { group: "self", label: "Own account", view: EVERYONE, manage: EVERYONE },
  notifications: { group: "self", label: "Own notifications", view: EVERYONE, manage: EVERYONE },
  reference: { group: "self", label: "Help, handbook, release notes", view: EVERYONE },
} as const satisfies Record<string, Grants & { group: AreaGroup; label: string }>;

export type Area = keyof typeof AREAS;

export const AREA_KEYS = Object.keys(AREAS) as Area[];

/** Every role, in display order. A test pins this to the Prisma enum so a new role cannot be forgotten. */
export const ALL_ROLES: readonly Role[] = ["ADMIN", "MANAGER", "TEAM_MANAGER", "RM", "FINANCE", "MARKETING", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"];

export function isArea(value: string): value is Area {
  return Object.prototype.hasOwnProperty.call(AREAS, value);
}

/** The one question. Default deny: an unknown role, area or action is refused. ADMIN holds every action on every declared area. */
export function can(role: Role | string | null | undefined, area: string, action: Action = "view"): boolean {
  if (!role || !isArea(area)) return false;
  if (!ACTIONS.includes(action)) return false;
  if (role === "ADMIN") return true;
  const granted: readonly Role[] | undefined = (AREAS[area] as Grants)[action];
  return granted?.includes(role as Role) ?? false;
}

/** Roles that hold an action on an area, ADMIN first. Used by the nav ceiling check, the matrix and the tests. */
export function rolesWith(area: Area, action: Action = "view"): Role[] {
  return ALL_ROLES.filter((role) => can(role, area, action));
}

export function areaLabel(area: Area): string {
  return AREAS[area].label;
}

export function areaGroup(area: Area): AreaGroup {
  return AREAS[area].group;
}
