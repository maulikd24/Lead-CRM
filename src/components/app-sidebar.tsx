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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandLockup } from "@/components/brand-lockup";
import { logoutAction } from "@/app/(dashboard)/actions";
import { PushTokenField } from "@/components/device-sync/push-token-field";
import { NAV_CATEGORIES, visibleNavItems, type NavItem } from "@/lib/nav-items";
import { activeNavHref, badgeText, buildSections, navStateKey, parseRemembered, resolveOpen, roleLabel } from "@/lib/wow/nav-sections";
import { cn, initials } from "@/lib/utils";
import type { Role } from "@/generated/prisma/client";

// Dispatched by the first-run tour so every category is expanded before it tries to highlight items.
export const EXPAND_NAV_EVENT = "supportify:expand-nav";

const SECTION_LABEL: Record<string, string> = { overview: "Overview" };
const sectionLabel = (key: string) => SECTION_LABEL[key] ?? NAV_CATEGORIES[key as keyof typeof NAV_CATEGORIES]?.label ?? key;

/** Which badge tone each counted item uses: new messages are good news to answer (lime), overdue work is a warning (red). */
const BADGE_TONE: Record<string, string> = {
  "/inbox": "bg-sidebar-primary text-sidebar-primary-foreground",
  "/tasks": "bg-destructive/15 text-[var(--destructive-ink)]",
};
const BADGE_NOUN: Record<string, string> = { "/inbox": "unread conversations", "/tasks": "overdue tasks", "/clients/duplicates": "possible duplicates" };

export function AppSidebar({ user, flags = [], counts = {} }: { user: { name: string; email: string; role: Role }; flags?: string[]; counts?: Record<string, number> }) {
  const pathname = usePathname();
  const { state } = useSidebar();

  // Every item this role may open, flag-aware, grouped into the always-visible sections (see NAV_ITEMS).
  const visibleItems: NavItem[] = visibleNavItems(user.role, flags);
  const sections = buildSections(visibleItems);
  const showLabels = sections.length > 1;

  const activeHref = activeNavHref(pathname, visibleItems.map((i) => i.href));
  const isActiveHref = (href: string) => href === activeHref;

  // Server and first client render agree (defaults only); the person's remembered choices are merged in after mount.
  const [remembered, setRemembered] = useState<Record<string, boolean>>({});
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => resolveOpen(sections, {}, isActiveHref));
  const storageKey = navStateKey(user.email);

  useEffect(() => {
    try {
      const stored = parseRemembered(window.localStorage.getItem(storageKey));
      setRemembered(stored);
      setOpenKeys(resolveOpen(sections, stored, isActiveHref));
    } catch {
      // localStorage unavailable: the sidebar works fine without remembered state.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per person
  }, [storageKey]);

  // Always reveal where you are, including after navigating via the command palette.
  const activeSection = sections.find((sec) => sec.items.some((i) => isActiveHref(i.href)))?.key;
  useEffect(() => {
    if (activeSection) setOpenKeys((prev) => (prev.has(activeSection) ? prev : new Set(prev).add(activeSection)));
  }, [activeSection]);

  useEffect(() => {
    const expandAll = () => setOpenKeys(new Set([...sections.map((sec) => sec.key), "overview"]));
    window.addEventListener(EXPAND_NAV_EVENT, expandAll);
    return () => window.removeEventListener(EXPAND_NAV_EVENT, expandAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the section keys only change with the role
  }, []);

  function toggle(key: string) {
    const next = new Set(openKeys);
    const nowOpen = !next.has(key);
    if (nowOpen) next.add(key);
    else next.delete(key);
    setOpenKeys(next);
    const mem = { ...remembered, [key]: nowOpen };
    setRemembered(mem);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(mem));
    } catch {
      // see above
    }
  }

  function renderItem(item: NavItem) {
    const count = counts[item.href];
    const text = badgeText(count);
    return (
      <SidebarMenuItem key={item.href} data-tour-nav={item.href}>
        <SidebarMenuButton render={<Link href={item.href} />} tooltip={item.label} isActive={isActiveHref(item.href)} className={cn(text && "pr-10")}>
          <item.icon className="size-4" />
          <span>{item.label}</span>
          {text && <span className="sr-only">{`, ${count} ${BADGE_NOUN[item.href] ?? "waiting"}`}</span>}
        </SidebarMenuButton>
        {text && (
          <>
            <SidebarMenuBadge aria-hidden className={cn("right-2 rounded-full text-xs font-semibold", BADGE_TONE[item.href] ?? "bg-sidebar-accent text-sidebar-foreground")}>
              {text}
            </SidebarMenuBadge>
            <span aria-hidden className="pointer-events-none absolute top-1 right-1 hidden size-2 rounded-full bg-sidebar-primary ring-2 ring-sidebar group-data-[collapsible=icon]:block" />
          </>
        )}
      </SidebarMenuItem>
    );
  }

  function renderSection(sec: (typeof sections)[number]) {
    const open = openKeys.has(sec.key);
    const hasActive = sec.items.some((i) => isActiveHref(i.href));
    const panelId = `nav-section-${sec.key}`;
    return (
      <SidebarGroup key={sec.key} className="p-0 px-2 py-1" data-nav-section={sec.key}>
        {showLabels && (
          <h2 className="m-0 group-data-[collapsible=icon]:hidden">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(sec.key)}
              className={cn(
                "group/label flex w-full items-center gap-1 rounded-md px-3 pt-2 pb-1 text-left text-xs font-semibold uppercase tracking-[0.06em] text-sidebar-foreground/50 outline-hidden transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                hasActive && "text-sidebar-foreground/80",
              )}
            >
              <span>{sectionLabel(sec.key)}</span>
              <ChevronRight aria-hidden className={cn("ml-auto size-3 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/label:opacity-100 group-focus-visible/label:opacity-100 motion-reduce:transition-none", open && "rotate-90 opacity-60")} />
            </button>
          </h2>
        )}
        <div
          id={panelId}
          data-open={open}
          inert={showLabels && !open && state !== "collapsed"}
          className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out data-[open=true]:grid-rows-[1fr] motion-reduce:transition-none group-data-[collapsible=icon]:grid-rows-[1fr] [&:not(:has(h2))]:grid-rows-[1fr]"
          style={showLabels ? undefined : { gridTemplateRows: "1fr" }}
        >
          <div className="min-h-0 overflow-hidden">
            <SidebarGroupContent>
              <SidebarMenu>{sec.items.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </div>
        </div>
      </SidebarGroup>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <BrandLockup className="px-2 py-1.5" />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main" className="flex flex-col pb-2">
          {sections.map(renderSection)}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
              <Avatar className="size-8 shrink-0 ring-2 ring-sidebar-primary/70 ring-offset-2 ring-offset-sidebar">
                <AvatarFallback className="text-[11px] font-semibold">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-[13px] font-semibold leading-tight">{user.name}</p>
                <p className="truncate text-[11px] leading-tight text-sidebar-foreground/60">{roleLabel(user.role)}</p>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logoutAction}>
              <PushTokenField />
              <SidebarMenuButton type="submit" tooltip="Sign out">
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
