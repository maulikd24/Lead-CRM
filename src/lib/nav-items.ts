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
  Briefcase,
  Landmark,
  Building2,
  Banknote,
  ClipboardCheck,
  ShieldCheck,
  Contact,
  Coins,
  Bug,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/generated/prisma/client";

export type WorkspaceKey = "core" | "partner" | "management" | "finance";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  /** Defaults to "core" when absent — purely descriptive, does not affect sidebar filtering. */
  workspace?: WorkspaceKey;
};

// Roles that can reach the universal, role-agnostic utility pages (own account settings, help,
// release notes) regardless of which workspace their other nav items put them in.
const DISTRIBUTION_OS_ROLES: Role[] = ["TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"];

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/copilot", label: "Co-pilot", icon: Sparkles, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/clients", label: "Clients", icon: Users, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/journeys", label: "Journeys", icon: Workflow, roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN", "MANAGER"] },
  { href: "/exceptions", label: "Exceptions", icon: AlertTriangle, roles: ["ADMIN", "MANAGER"] },
  { href: "/households", label: "Households", icon: Landmark, roles: ["ADMIN", "MANAGER"] },
  { href: "/release-notes", label: "Release Notes", icon: History, roles: ["ADMIN", "MANAGER", "RM", "DEALER", ...DISTRIBUTION_OS_ROLES] },
  { href: "/dealer-desk", label: "Dealer Desk", icon: Handshake, roles: ["DEALER"] },
  { href: "/partner-home", label: "Partner Home", icon: Briefcase, roles: ["PARTNER", "AFFILIATE", "DISTRIBUTOR"], workspace: "partner" },
  { href: "/management-console", label: "Management Console", icon: Building2, roles: ["TEAM_MANAGER"], workspace: "management" },
  { href: "/finance-console", label: "Finance Console", icon: Banknote, roles: ["FINANCE", "ADMIN"], workspace: "finance" },
  { href: "/earnings", label: "Earnings", icon: Coins, roles: ["ADMIN", "FINANCE"] },
  { href: "/debugger", label: "Debugger", icon: Bug, roles: ["ADMIN"] },
  { href: "/settings/stages", label: "Stages", icon: SlidersHorizontal, roles: ["ADMIN"] },
  { href: "/settings/templates", label: "Templates", icon: MessageSquareText, roles: ["ADMIN"] },
  { href: "/settings/users", label: "Users", icon: UserCog, roles: ["ADMIN"] },
  { href: "/settings/integrations", label: "Apps & Integrations", icon: Plug, roles: ["ADMIN"] },
  { href: "/settings/approval-workflows", label: "Approval Workflows", icon: ClipboardCheck, roles: ["ADMIN"] },
  { href: "/settings/data-privacy", label: "Data Privacy", icon: ShieldCheck, roles: ["ADMIN"] },
  { href: "/settings/partner-tiers", label: "Partner Directory", icon: Contact, roles: ["ADMIN"] },
  { href: "/settings/account", label: "Settings", icon: Settings, roles: ["ADMIN", "MANAGER", "RM", "DEALER", ...DISTRIBUTION_OS_ROLES] },
  { href: "/help", label: "Help", icon: HelpCircle, roles: ["ADMIN", "MANAGER", "RM", "DEALER", ...DISTRIBUTION_OS_ROLES] },
];
