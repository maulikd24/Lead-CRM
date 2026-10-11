import {
  LayoutDashboard,
  Users,
  UserCog,
  CheckSquare,
  Workflow,
  BarChart3,
  Settings,
  MessageSquareText,
  SlidersHorizontal,
  Plug,
  Sparkles,
  HelpCircle,
  AlertTriangle,
  Handshake,
  History,
  Activity,
  Shuffle,
  Briefcase,
  Landmark,
  Building2,
  Banknote,
  ClipboardCheck,
  ShieldCheck,
  Contact,
  Coins,
  Gift,
  Bug,
  TrendingUp,
  Server,
  Gauge,
  BookOpen,
  FileText,
  MessagesSquare,
  MessageCircle,
  Headphones,
  FolderKanban,
  ChartLine,
  Zap,
  Wallet,
  Wrench,
  LibraryBig,
  Rocket,
  FileUp,
  Brain,
  PhoneCall,
  Merge,
  Headset,
  Megaphone,
  Target,
  Network,
  IndianRupee,
  Filter,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/generated/prisma/client";
import type { NavFlag } from "@/lib/nav-flags";
import { can, type Area } from "@/lib/access/policy";

export type WorkspaceKey = "core" | "partner" | "management" | "finance" | "marketing";
export type NavCategoryKey = "work" | "insights" | "automation" | "finance" | "administration" | "reference";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The registry area this item opens (src/lib/access/policy.ts). `roles` can only narrow it: the access test fails if an item lists a role the registry refuses. */
  area: Area;
  roles: Role[];
  /** Defaults to "core" when absent — purely descriptive, does not affect sidebar filtering. */
  workspace?: WorkspaceKey;
  /** The sidebar main category this item sits under. Absent = a standalone top-level link. A category
   * with only one item visible to the current role also renders as a plain link (see AppSidebar). */
  category?: NavCategoryKey;
  /** When set, the item is hidden unless this feature flag is enabled. Flags are defined and evaluated in one place, src/lib/nav-flags.ts. */
  flag?: NavFlag;
};

export type { NavFlag };

export function navItemEnabled(item: NavItem, enabledFlags: readonly string[]): boolean {
  return !item.flag || enabledFlags.includes(item.flag);
}

/** Ordering of categories is decided by where each category's first item appears in NAV_ITEMS. */
export const NAV_CATEGORIES: Record<NavCategoryKey, { label: string; icon: LucideIcon }> = {
  work: { label: "Work", icon: FolderKanban },
  insights: { label: "Insights", icon: ChartLine },
  automation: { label: "Automation", icon: Zap },
  finance: { label: "Finance", icon: Wallet },
  administration: { label: "Admin & Settings", icon: Wrench },
  reference: { label: "Help & Reference", icon: LibraryBig },
};

// Roles that can reach the universal, role-agnostic utility pages (own account settings, help,
// release notes) regardless of which workspace their other nav items put them in.
const DISTRIBUTION_OS_ROLES: Role[] = ["TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "MARKETING"];

// Array order IS sidebar order: the sidebar walks this list and emits a category the first time it
// meets one of its items. Command palette, Help page, and the app tour read the same order.
const ALL_ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER", ...DISTRIBUTION_OS_ROLES];

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, area: "dashboard", roles: ["ADMIN", "MANAGER", "RM"] },

  { href: "/copilot", label: "Co-pilot", icon: Sparkles, area: "copilot", roles: ["ADMIN", "MANAGER", "RM"], category: "work" },
  { href: "/clients", label: "Clients", icon: Users, area: "clients", roles: ["ADMIN", "MANAGER", "RM"], category: "work" },
  { href: "/clients/duplicates", label: "Duplicate customers", icon: Merge, area: "duplicates", roles: ["ADMIN", "MANAGER", "RM"], category: "work", flag: "merge-review" },
  { href: "/households", label: "Households", icon: Landmark, area: "households", roles: ["ADMIN", "MANAGER"], category: "work" },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, area: "tasks", roles: ["ADMIN", "MANAGER", "RM", "MARKETING"], category: "work" },
  { href: "/approvals", label: "Approvals", icon: ListChecks, area: "approvals", roles: ["ADMIN", "MANAGER", "RM", "FINANCE", "MARKETING"], category: "work", flag: "approvals-inbox" },
  { href: "/inbox", label: "Inbox", icon: MessagesSquare, area: "inbox", roles: ["ADMIN", "MANAGER", "RM"], category: "work" },
  { href: "/agents", label: "Agent drafts", icon: Sparkles, area: "agent-drafts", roles: ["ADMIN", "MANAGER", "RM"], category: "work" },

  { href: "/reports", label: "Reports", icon: BarChart3, area: "reports", roles: ["ADMIN", "MANAGER"], category: "insights" },
  { href: "/management-dashboard", label: "Manager Dashboard", icon: TrendingUp, area: "management-dashboard", roles: ["ADMIN", "MANAGER"], category: "insights" },
  { href: "/intelligence", label: "Customer Intelligence", icon: Brain, area: "intelligence", roles: ["ADMIN", "MANAGER"], category: "insights" },
  { href: "/marketing", label: "Marketing", icon: Megaphone, area: "marketing", roles: ["ADMIN", "MARKETING"], category: "insights", flag: "marketing" },
  { href: "/closed-loop", label: "Closed loop", icon: Megaphone, area: "marketing-attribution", roles: ["ADMIN", "MARKETING"], category: "insights", flag: "closed-loop" },
  { href: "/marketing?tab=impact", label: "Campaign impact", icon: Target, area: "marketing-attribution", roles: ["ADMIN", "MARKETING"], category: "insights", flag: "attribution" },
  { href: "/settings/lead-leakage", label: "Lead leakage", icon: Filter, area: "marketing-attribution", roles: ["ADMIN", "MARKETING"], category: "insights", flag: "attribution" },
  { href: "/quality-audit", label: "Quality Audit", icon: Headphones, area: "quality-audit", roles: ["ADMIN", "MANAGER", "RM"], category: "insights" },
  // Call recordings review: admins and managers only; kept out of PRIMARY_NAV on purpose (reached from Insights and Cmd+K).
  { href: "/calls", label: "Call recordings", icon: PhoneCall, area: "calls", roles: ["ADMIN", "MANAGER"], category: "insights", flag: "calls-review" },
  { href: "/support", label: "Support SLA", icon: Headset, area: "support", roles: ["ADMIN", "MANAGER"], category: "insights", flag: "support-sla" },
  { href: "/exceptions", label: "Exceptions", icon: AlertTriangle, area: "exceptions", roles: ["ADMIN", "MANAGER"], category: "insights" },

  { href: "/journeys", label: "Journeys", icon: Workflow, area: "journeys", roles: ["ADMIN", "MANAGER"], category: "automation" },

  { href: "/dealer-desk", label: "Dealer Desk", icon: Handshake, area: "dealer-desk", roles: ["DEALER"] },
  { href: "/partner-home", label: "Partner Home", icon: Briefcase, area: "partner-home", roles: ["PARTNER", "AFFILIATE", "DISTRIBUTOR"], workspace: "partner" },
  { href: "/management-console", label: "Management Console", icon: Building2, area: "management-console", roles: ["TEAM_MANAGER"], workspace: "management" },

  // Admin and Finance see the whole programme; partner users and team managers see only their own network and team (the pages narrow it, and the data layer enforces it).
  { href: "/partners", label: "Partner workspace", icon: Network, area: "partner-workspace", roles: ["ADMIN", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"], category: "insights", flag: "partner-workspace" },

  { href: "/referrals", label: "Referrals", icon: Gift, area: "referral-program", roles: ["ADMIN", "FINANCE", "MARKETING"], category: "finance", flag: "referral-program" },
  { href: "/earnings", label: "Earnings", icon: Coins, area: "earnings", roles: ["ADMIN", "FINANCE"], category: "finance" },
  { href: "/finance-console", label: "Finance Console", icon: Banknote, area: "finance-console", roles: ["FINANCE", "ADMIN"], workspace: "finance", category: "finance" },

  { href: "/settings/account", label: "Settings", icon: Settings, area: "account", roles: ALL_ROLES, category: "administration" },
  { href: "/settings/stages", label: "Stages", icon: SlidersHorizontal, area: "settings-stages", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/templates", label: "Templates", icon: MessageSquareText, area: "settings-templates", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/access", label: "Who can see what", icon: ShieldCheck, area: "settings-access", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/users", label: "Users", icon: UserCog, area: "settings-users", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/integrations", label: "Apps & Integrations", icon: Plug, area: "marketing-ad-integrations", roles: ["ADMIN", "MARKETING"], category: "administration" },
  { href: "/settings/whatsapp", label: "WhatsApp Accounts", icon: MessageCircle, area: "settings-whatsapp", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/approval-workflows", label: "Approval Workflows", icon: ClipboardCheck, area: "settings-approvals", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/lead-assignment", label: "Lead Assignment", icon: Shuffle, area: "settings-lead-assignment", roles: ["ADMIN"], category: "administration" },
  { href: "/activity-log", label: "Activity Log", icon: Activity, area: "activity-log", roles: ["ADMIN", "MANAGER"], category: "administration" },
  { href: "/settings/data-privacy", label: "Data Privacy", icon: ShieldCheck, area: "settings-data-privacy", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/partner-tiers", label: "Partner Directory", icon: Contact, area: "partner-directory", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/partner-finance", label: "Partner finance", icon: IndianRupee, area: "partner-finance", roles: ["ADMIN", "FINANCE"], category: "administration", flag: "partner-workspace" },
  { href: "/settings/backoffice-import", label: "Back-office import", icon: FileUp, area: "settings-backoffice-import", roles: ["ADMIN"], category: "administration", flag: "backoffice-import" },
  { href: "/settings/go-live", label: "Go-Live Checklist", icon: Rocket, area: "settings-go-live", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/system", label: "System Overview", icon: Server, area: "settings-system", roles: ["ADMIN"], category: "administration" },
  { href: "/settings/control-plane", label: "Control plane", icon: Gauge, area: "control-plane", roles: ["ADMIN"], category: "administration", flag: "control-plane" },
  { href: "/debugger", label: "Debugger", icon: Bug, area: "debugger", roles: ["ADMIN"], category: "administration" },

  { href: "/handbook", label: "Handbook", icon: BookOpen, area: "reference", roles: ALL_ROLES, category: "reference" },
  { href: "/feature-specs", label: "Feature Specs", icon: FileText, area: "feature-specs", roles: ["ADMIN", "MANAGER"], category: "reference" },
  { href: "/release-notes", label: "Release Notes", icon: History, area: "reference", roles: ALL_ROLES, category: "reference" },
  { href: "/help", label: "Help", icon: HelpCircle, area: "reference", roles: ALL_ROLES, category: "reference" },
];

const PRIMARY_NAV: Record<Role, string[]> = {
  RM: ["/dashboard", "/clients", "/inbox", "/tasks", "/copilot", "/agents"],
  MANAGER: ["/dashboard", "/clients", "/inbox", "/management-dashboard", "/intelligence", "/reports"],
  ADMIN: ["/dashboard", "/clients", "/management-dashboard", "/intelligence", "/journeys", "/settings/account"],
  DEALER: ["/dealer-desk"],
  TEAM_MANAGER: ["/management-console"],
  PARTNER: ["/partner-home"],
  AFFILIATE: ["/partner-home"],
  DISTRIBUTOR: ["/partner-home"],
  FINANCE: ["/finance-console", "/earnings"],
  MARKETING: ["/marketing", "/referrals", "/tasks", "/settings/integrations"],
};

/** The few screens a role lives in. Everything else stays reachable through Cmd+K, which still reads NAV_ITEMS. */
export function primaryNavFor(role: Role, enabledFlags: readonly string[] = []): NavItem[] {
  return PRIMARY_NAV[role]
    .map((href) => NAV_ITEMS.find((item) => item.href === href && item.roles.includes(role) && can(role, item.area, "view") && navItemEnabled(item, enabledFlags)))
    .filter((item): item is NavItem => item !== undefined);
}

/** The one place that decides what a role sees: role match, and any feature flag the item sits behind. Sidebar, palette and help all use it. */
export function visibleNavItems(role: Role, enabledFlags: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role) && can(role, item.area, "view") && navItemEnabled(item, enabledFlags));
}
