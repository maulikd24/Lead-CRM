"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Logo } from "@/components/logo";
import { logoutAction } from "@/app/(dashboard)/actions";
import { PushTokenField } from "@/components/device-sync/push-token-field";
import { NAV_CATEGORIES, NAV_ITEMS, type NavCategoryKey, type NavItem } from "@/lib/nav-items";
import { cn, initials } from "@/lib/utils";
import type { Role } from "@/generated/prisma/client";

const OPEN_STORAGE_KEY = "supportify:navOpen";
// Dispatched by the first-run tour so every category is expanded before it tries to highlight items.
export const EXPAND_NAV_EVENT = "supportify:expand-nav";

type SidebarEntry = { type: "item"; item: NavItem } | { type: "category"; key: NavCategoryKey; items: NavItem[] };

/** Array order in NAV_ITEMS is sidebar order: a category is emitted where its first item appears, and a
 * category with only one item visible to this role collapses to a plain top-level link. */
function buildEntries(items: NavItem[]): SidebarEntry[] {
  const entries: SidebarEntry[] = [];
  const emitted = new Set<NavCategoryKey>();
  for (const item of items) {
    if (!item.category) {
      entries.push({ type: "item", item });
      continue;
    }
    if (emitted.has(item.category)) continue;
    emitted.add(item.category);
    const members = items.filter((i) => i.category === item.category);
    entries.push(members.length > 1 ? { type: "category", key: item.category, items: members } : { type: "item", item });
  }
  return entries;
}

export function AppSidebar({ user }: { user: { name: string; email: string; role: Role } }) {
  const pathname = usePathname();
  const { state, setOpen } = useSidebar();

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const entries = buildEntries(visibleItems);

  const isActiveHref = (href: string) => pathname.startsWith(href);
  const activeCategory = visibleItems.find((item) => item.category && isActiveHref(item.href))?.category;

  // Initial state is just the active category so server and first client render agree; the remembered
  // set is merged in after mount (below).
  const [openKeys, setOpenKeys] = useState<Set<NavCategoryKey>>(() => new Set(activeCategory ? [activeCategory] : []));

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(OPEN_STORAGE_KEY) ?? "[]") as NavCategoryKey[];
      if (Array.isArray(stored)) setOpenKeys((prev) => new Set([...prev, ...stored]));
    } catch {
      // localStorage unavailable or corrupt — the sidebar works fine without remembered state.
    }
  }, []);

  // Always reveal where you are, including after navigating via the command palette.
  useEffect(() => {
    if (activeCategory) setOpenKeys((prev) => (prev.has(activeCategory) ? prev : new Set(prev).add(activeCategory)));
  }, [activeCategory]);

  useEffect(() => {
    const expandAll = () => setOpenKeys(new Set(Object.keys(NAV_CATEGORIES) as NavCategoryKey[]));
    window.addEventListener(EXPAND_NAV_EVENT, expandAll);
    return () => window.removeEventListener(EXPAND_NAV_EVENT, expandAll);
  }, []);

  function persist(next: Set<NavCategoryKey>) {
    try {
      window.localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // see above
    }
  }

  function toggleCategory(key: NavCategoryKey) {
    // Icon-only sidebar hides sub-lists, so a click there expands the sidebar and opens the category.
    if (state === "collapsed") {
      setOpen(true);
      const next = new Set(openKeys).add(key);
      setOpenKeys(next);
      persist(next);
      return;
    }
    const next = new Set(openKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenKeys(next);
    persist(next);
  }

  function renderItem(item: NavItem) {
    return (
      <SidebarMenuItem key={item.href} data-tour-nav={item.href}>
        <SidebarMenuButton render={<Link href={item.href} />} isActive={isActiveHref(item.href)}>
          <item.icon className="size-4" />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  function renderCategory(key: NavCategoryKey, items: NavItem[]) {
    const { label, icon: Icon } = NAV_CATEGORIES[key];
    const open = openKeys.has(key);
    const hasActiveChild = items.some((i) => isActiveHref(i.href));
    return (
      <SidebarMenuItem key={key}>
        <SidebarMenuButton
          type="button"
          tooltip={label}
          aria-expanded={open}
          onClick={() => toggleCategory(key)}
          className={cn(hasActiveChild && "font-semibold")}
        >
          <Icon className="size-4" />
          <span>{label}</span>
          <ChevronRight className={cn("ml-auto size-4 transition-transform", open && "rotate-90")} />
        </SidebarMenuButton>
        {open && (
          <SidebarMenuSub>
            {items.map((item) => (
              <SidebarMenuSubItem key={item.href} data-tour-nav={item.href}>
                <SidebarMenuSubButton render={<Link href={item.href} />} isActive={isActiveHref(item.href)}>
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        )}
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Logo className="size-7 shrink-0" />
          <span className="font-heading text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Supportify
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {entries.map((entry) => (entry.type === "item" ? renderItem(entry.item) : renderCategory(entry.key, entry.items)))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1">
              <Avatar className="size-6">
                <AvatarFallback className="text-[10px]">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium leading-tight">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground leading-tight">{user.role}</p>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logoutAction}>
              <PushTokenField />
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
