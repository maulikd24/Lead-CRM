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
  Bug,
  TrendingUp,
  Server,
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
  Brain,
  Headset,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/generated/prisma/client";

export type WorkspaceKey = "core" | "partner" | "management" | "finance";
export type NavCategoryKey = "work" | "insights" | "automation" | "finance" | "administration" | "reference";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  /** Defaults to "core" when absent — purely descriptive, does not affect sidebar filtering. */
  workspace?: WorkspaceKey;
  /** The sidebar main category this item sits under. Absent = a standalone top-level link. A category
   * with only one item visible to the current role also renders as a plain link (see AppSidebar). */
  category?: NavCategoryKey;
};

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
const DISTRIBUTION_OS_ROLES: Role[] = ["TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"];

// Array order IS sidebar order: the sidebar walks this list and emits a category the first time it
// meets one of its items. Command palette, Help page, and the app tour read the same order.
const ALL_ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER", ...DISTRIBUTION_OS_ROLES];

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "RM"] },

  { href: "/copilot", label: "Co-pilot", icon: Sparkles, roles: ["ADMIN", "MANAGER", "RM"], category: "work" },
  { href: "/clients", label: "Clients", icon: Users, roles: ["ADMIN", "MANAGER", "RM"], category: "work" },
  { href: "/households", label: "Households", icon: Landmark, roles: ["ADMIN", "MANAGER"], category: "work" },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "RM"], category: "work" },
  { href: "/inbox", label: "Inbox", icon: MessagesSquare, roles: ["ADMIN", "MANAGER", "RM"], category: "work" },
  { href: "/agents", label: "Agent drafts", icon: Sparkles, roles: ["ADMIN", "MANAGER", "RM"], category: "work" },

  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN", "MANAGER"], category: "insights" },
  { href: "/management-dashboard", label: "Manager Dashboard", icon: TrendingUp, roles: ["ADMIN", "MANAGER"], category: "insights" },
  { href: "/intelligence", label: "Customer Intelligence", icon: Brain, roles: ["ADMIN", "MANAGER"], category: "insights" },
  { href: "/quality-audit", label: "Quality Audit", icon: Headphones, roles: ["ADMIN", "MANAGER", "RM"], category: "insights" },
  // Behind NEXT_PUBLIC_SUPPORT_SLA=1 (inlined at build time, so the sidebar can read it).
  ...(process.env.NEXT_PUBLIC_SUPPORT_SLA === "1" ? [{ href: "/support", label: "Support SLA", icon: Headset, roles: ["ADMIN", "MANAGER"] as Role[], category: "insights" as const }] : []),
  { href: "/exceptions", label: "Exceptions", icon: AlertTriangle, roles: ["ADMIN", "MANAGER"], category: "insights" },

  { href: "/journeys", label: "Journeys", icon: Workflow, roles: ["ADMIN", "MANAGER"], category: "automation" },

  { href: "/dealer-desk", label: "Dealer Desk", icon: Handshake, roles: ["DEALER"] },
  { href: "/partner-home", label: "Partner Home", icon: Briefcase, roles: ["PARTNER", "AFFILIATE", "DISTRIBUTOR"], workspace: "partner" },
  { href: "/management-console", label: "Management Console", icon: Building2, roles: ["TEAM_MANAGER"], workspace: "management" },

  { href: "/earnings", label: "Earnings", icon: Coins, roles: ["ADMIN", "FINANCE"], category: "finance" },
  { href: "/finance-console", label: "Finance Console", icon: Banknote, roles: ["FINANCE", "ADMIN"], workspace: "finance", category: "finance" },

  { href: "/settings/account", label: "Settings", icon: Settings, roles: ALL_ROLES, category: "administration" },
  { href: "/settings/stages", label: "Stages", icon: SlidersHorizontal, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/templates", label: "Templates", icon: MessageSquareText, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/users", label: "Users", icon: UserCog, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/integrations", label: "Apps & Integrations", icon: Plug, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/whatsapp", label: "WhatsApp Accounts", icon: MessageCircle, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/approval-workflows", label: "Approval Workflows", icon: ClipboardCheck, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/lead-assignment", label: "Lead Assignment", icon: Shuffle, roles: ["ADMIN"], category: "administration" },
  { href: "/activity-log", label: "Activity Log", icon: Activity, roles: ["ADMIN", "MANAGER"], category: "administration" },
  { href: "/settings/data-privacy", label: "Data Privacy", icon: ShieldCheck, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/partner-tiers", label: "Partner Directory", icon: Contact, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/go-live", label: "Go-Live Checklist", icon: Rocket, roles: ["ADMIN"], category: "administration" },
  { href: "/settings/system", label: "System Overview", icon: Server, roles: ["ADMIN"], category: "administration" },
  { href: "/debugger", label: "Debugger", icon: Bug, roles: ["ADMIN"], category: "administration" },

  { href: "/handbook", label: "Handbook", icon: BookOpen, roles: ALL_ROLES, category: "reference" },
  { href: "/feature-specs", label: "Feature Specs", icon: FileText, roles: ["ADMIN", "MANAGER"], category: "reference" },
  { href: "/release-notes", label: "Release Notes", icon: History, roles: ALL_ROLES, category: "reference" },
  { href: "/help", label: "Help", icon: HelpCircle, roles: ALL_ROLES, category: "reference" },
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
};

/** The few screens a role lives in. Everything else stays reachable through Cmd+K, which still reads NAV_ITEMS. */
export function primaryNavFor(role: Role): NavItem[] {
  return PRIMARY_NAV[role]
    .map((href) => NAV_ITEMS.find((item) => item.href === href && item.roles.includes(role)))
    .filter((item): item is NavItem => item !== undefined);
}
