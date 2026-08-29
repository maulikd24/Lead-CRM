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
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/generated/prisma/client";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/copilot", label: "Co-pilot", icon: Sparkles, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/clients", label: "Clients", icon: Users, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/journeys", label: "Journeys", icon: Workflow, roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN", "MANAGER"] },
  { href: "/settings/stages", label: "Stages", icon: SlidersHorizontal, roles: ["ADMIN"] },
  { href: "/settings/templates", label: "Templates", icon: MessageSquareText, roles: ["ADMIN"] },
  { href: "/settings/users", label: "Users", icon: UserCog, roles: ["ADMIN"] },
  { href: "/settings/integrations", label: "Apps & Integrations", icon: Plug, roles: ["ADMIN"] },
  { href: "/settings/account", label: "Settings", icon: Settings, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/help", label: "Help", icon: HelpCircle, roles: ["ADMIN", "MANAGER", "RM"] },
];
