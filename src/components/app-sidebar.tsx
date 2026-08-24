"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  UserCog,
  Contact,
  Handshake,
  CheckSquare,
  Workflow,
  Settings,
  MessageSquareText,
  LogOut,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { logoutAction } from "@/app/(dashboard)/actions";
import type { Role } from "@/generated/prisma/client";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/leads", label: "My Leads", icon: Users, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/contacts", label: "Contacts", icon: Contact, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/deals", label: "Pipeline", icon: Handshake, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/journeys", label: "Journeys", icon: Workflow, roles: ["ADMIN", "MANAGER"] },
  { href: "/settings/templates", label: "Templates", icon: MessageSquareText, roles: ["ADMIN"] },
  { href: "/settings/users", label: "Users", icon: UserCog, roles: ["ADMIN"] },
  { href: "/settings/integrations", label: "Settings", icon: Settings, roles: ["ADMIN"] },
];

export function AppSidebar({ user }: { user: { name: string; email: string; role: Role } }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-sm font-semibold">CRM</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.filter((item) => item.roles.includes(user.role)).map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={pathname.startsWith(item.href)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="px-2 py-1 text-xs text-muted-foreground truncate">
              {user.name} · {user.role}
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logoutAction}>
              <SidebarMenuButton type="submit">
                <LogOut className="size-4" />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
