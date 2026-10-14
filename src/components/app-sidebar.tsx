"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, LayoutGrid, LogOut, Settings, HelpCircle } from "lucide-react";

import { Sidebar, SidebarFooter, SidebarHeader, useSidebar } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandLockup } from "@/components/brand-lockup";
import { logoutAction } from "@/app/(dashboard)/actions";
import { PushTokenField } from "@/components/device-sync/push-token-field";
import { TakeTourButton } from "@/components/app-tour/take-tour-button";
import { SPACES, type SpaceKey } from "@/lib/nav-items";
import { activeNavEntry, navEntriesFor, panelFor, railFor, spaceHome, spaceOfEntry, type NavEntry } from "@/lib/nav/model";
import { badgeText, roleLabel } from "@/lib/wow/nav-sections";
import { cn, initials } from "@/lib/utils";
import type { Role } from "@/generated/prisma/client";

/** Kept for the first-run tour: it asks the nav to show everything before it highlights items. The two-level nav has nothing to expand. */
export const EXPAND_NAV_EVENT = "supportify:expand-nav";

/** Which badge tone each counted item uses: new messages are good news to answer (lime), overdue work is a warning (red). */
const BADGE_TONE: Record<string, string> = {
  "/inbox": "bg-sidebar-primary text-sidebar-primary-foreground",
  "/tasks": "bg-destructive/15 text-destructive",
  "/approvals": "bg-sidebar-primary text-sidebar-primary-foreground",
};
const BADGE_NOUN: Record<string, string> = { "/inbox": "unread conversations", "/tasks": "overdue tasks", "/clients/duplicates": "possible duplicates", "/approvals": "approvals waiting" };

type Props = { user: { name: string; email: string; role: Role }; flags?: string[]; counts?: Record<string, number>; setupNeeded?: string[] };

/**
 * The two-level navigation: a slim rail of labelled workspace icons, and a panel of grouped items for the active workspace. Everything is
 * derived from NAV_ITEMS through the policy registry (src/lib/nav/model.ts), so a module that arrives later only declares its workspace
 * and group. Collapsing leaves the icon-only rail; the choice is remembered per person (cookie, set by the sidebar provider).
 */
export function AppSidebar({ user, flags = [], counts = {}, setupNeeded = [] }: Props) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { state, isMobile } = useSidebar();
  const navRef = useRef<HTMLDivElement>(null);
  const [showMore, setShowMore] = useState<Record<string, boolean>>({});

  const entries = useMemo(() => navEntriesFor(user.role, flags, { setupNeeded }), [user.role, flags, setupNeeded]);
  const rail = useMemo(() => railFor(entries), [entries]);
  const activeHref = activeNavEntry(pathname, search, entries.filter((e) => e.state !== "off").map((e) => e.href));
  const activeSpace: SpaceKey = (() => {
    const s = spaceOfEntry(entries, activeHref);
    return s && rail.some((r) => r.space === s) ? s : (rail[0]?.space ?? "today");
  })();
  const groups = useMemo(() => panelFor(entries, activeSpace), [entries, activeSpace]);
  const sumFor = (space: SpaceKey) => panelFor(entries, space).flatMap((g) => g.entries).reduce((n, e) => n + (e.state === "active" ? (counts[e.href] ?? 0) : 0), 0);
  const collapsed = state === "collapsed" && !isMobile; // the phone sheet is always the full rail and panel

  // Arrow keys: up and down inside the rail or the panel, right from the rail into the panel, left back to the rail. Home and End jump to the ends.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const zone = target.closest<HTMLElement>("[data-nav-zone]")?.dataset.navZone;
    if (!zone || !navRef.current) return;
    const items = (z: string) => [...navRef.current!.querySelectorAll<HTMLElement>(`[data-nav-zone="${z}"] [data-nav-item]`)];
    const list = items(zone);
    const i = list.indexOf(target);
    let next: HTMLElement | undefined;
    if (e.key === "ArrowDown") next = list[Math.min(list.length - 1, i + 1)];
    else if (e.key === "ArrowUp") next = list[Math.max(0, i - 1)];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "ArrowRight" && zone === "rail") next = items("panel").find((el) => el.getAttribute("aria-current") === "page") ?? items("panel")[0];
    else if (e.key === "ArrowLeft" && zone === "panel") next = items("rail").find((el) => el.getAttribute("aria-current") === "true") ?? items("rail")[0];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  function renderEntry(entry: NavEntry) {
    const current = entry.href === activeHref;
    const count = entry.state === "active" ? counts[entry.href] : undefined;
    const text = badgeText(count);
    const base = "relative flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-hidden ring-sidebar-ring focus-visible:ring-2";
    // The current row is a lime fill: its pill takes the active-row ink (sidebar-primary-foreground), not the muted sidebar text, which is too faint on lime.
    const pillTone = current && entry.state !== "off" ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/(--sidebar-muted-alpha)";
    const body = (
      <>
        <entry.icon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.state !== "active" && <span className={cn("shrink-0 rounded-full border border-sidebar-border px-1.5 text-xs leading-5", pillTone)}>{entry.state === "off" ? "Off" : "Needs setup"}</span>}
        {text && (
          <>
            <span aria-hidden className={cn("shrink-0 rounded-full px-1.5 text-xs font-semibold leading-5", BADGE_TONE[entry.href] ?? "bg-sidebar-accent text-sidebar-foreground")}>{text}</span>
            <span className="sr-only">{`, ${count} ${BADGE_NOUN[entry.href] ?? "waiting"}`}</span>
          </>
        )}
      </>
    );
    if (entry.state === "off") {
      // Greyed and not a link: the module is switched off. ADMIN still sees it, with its state, so nothing is hidden from the person who can switch it on.
      return (
        <li key={entry.href}>
          <div aria-disabled="true" title={entry.stateNote} className={cn(base, "cursor-default text-sidebar-foreground/45")} data-nav-state="off">
            {body}
            <span className="sr-only">{`. ${entry.stateNote}`}</span>
          </div>
        </li>
      );
    }
    return (
      <li key={entry.href} data-tour-nav={entry.href}>
        <Link
          href={entry.href}
          prefetch={entry.prefetch === false ? false : undefined}
          data-nav-item
          aria-current={current ? "page" : undefined}
          title={entry.state === "setup" ? entry.stateNote : undefined}
          className={cn(base, "hover:bg-sidebar-accent", current && "bg-sidebar-primary font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary", entry.state === "setup" && !current && "text-sidebar-foreground/70")}
        >
          {body}
        </Link>
      </li>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <div ref={navRef} onKeyDown={onKeyDown} className="flex min-h-0 flex-1">
        {/* The rail: always there (icon-only when collapsed). */}
        <div className="flex w-17 shrink-0 flex-col items-center border-r border-sidebar-border py-2 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:border-r-0">
          <nav aria-label="Workspaces" data-nav-zone="rail" className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5">
            <Link href={spaceHome(entries, "today") ?? "/dashboard"} aria-label="Allvest Customer OS home" className="mb-2 flex size-10 items-center justify-center rounded-md outline-hidden ring-sidebar-ring focus-visible:ring-2">
              <BrandLockup compact className="[&>div]:hidden" />
            </Link>
            <ul className="flex w-full flex-col items-center gap-1">
              {rail.map((r) => {
                const sp = SPACES[r.space];
                const here = r.space === activeSpace;
                // The open workspace shows its counts on its own items, so its rail icon does not add them up a second time.
                const badge = here ? null : badgeText(sumFor(r.space));
                return (
                  <li key={r.space} className="w-full">
                    <Link
                      href={spaceHome(entries, r.space) ?? "/dashboard"}
                      data-nav-item
                      data-tour-space={r.space}
                      aria-current={here ? "true" : undefined}
                      aria-label={badge ? `${sp.label}, ${sumFor(r.space)} waiting` : sp.label}
                      title={sp.label}
                      className={cn("relative flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-xs font-medium outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2", here && "bg-sidebar-accent")}
                    >
                      <span className={cn("flex size-8 items-center justify-center rounded-md", here && "bg-sidebar-primary text-sidebar-primary-foreground")}>
                        <sp.icon aria-hidden className="size-[18px]" />
                      </span>
                      <span className="group-data-[collapsible=icon]:sr-only">{sp.label}</span>
                      {badge && <span aria-hidden className="absolute top-1 right-2 min-w-4 rounded-full bg-destructive px-1 text-center text-[11px] leading-4 font-semibold text-white">{badge}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        {/* The panel: the active workspace's grouped items. Hidden when the rail is collapsed. */}
        {!collapsed && (
          <div className="flex min-w-0 flex-1 flex-col">
            <SidebarHeader className="px-4 pt-3 pb-1">
              <BrandLockup onSidebar />
            </SidebarHeader>
            <div key={activeSpace} className="nav-panel-enter flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
              <h2 className="px-2.5 pt-3 pb-1 font-heading text-base font-semibold tracking-tight">{SPACES[activeSpace].label}</h2>
              <nav aria-label={`${SPACES[activeSpace].label} pages`} data-nav-zone="panel" className="flex flex-col gap-3">
                {groups.map((g) => {
                  const primary = g.entries.filter((e) => !e.more || e.href === activeHref);
                  const more = g.entries.filter((e) => !primary.includes(e));
                  const open = showMore[`${activeSpace}:${g.group}`] ?? false;
                  return (
                    <div key={g.group} data-nav-group={g.group}>
                      <h3 className="px-2.5 pb-1 text-xs font-semibold tracking-[0.06em] text-sidebar-foreground/(--sidebar-muted-alpha) uppercase">{g.group}</h3>
                      <ul className="flex flex-col">
                        {primary.map(renderEntry)}
                        {open && more.map(renderEntry)}
                      </ul>
                      {more.length > 0 && (
                        <button
                          type="button"
                          data-nav-item
                          aria-expanded={open}
                          onClick={() => setShowMore((m) => ({ ...m, [`${activeSpace}:${g.group}`]: !open }))}
                          className="mt-0.5 flex min-h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-xs text-sidebar-foreground/(--sidebar-muted-alpha) outline-hidden ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2"
                        >
                          <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
                          {open ? "Fewer" : `${more.length} more`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
            <div className="border-t border-sidebar-border px-2 py-2">
              <ul className="flex flex-col">
                {user.role === "ADMIN" && <FooterLink href="/modules" icon={LayoutGrid} label="All modules" current={pathname === "/modules"} />}
                <FooterLink href="/settings/account" icon={Settings} label="Settings" current={pathname.startsWith("/settings/account")} />
                <FooterLink href="/help" icon={HelpCircle} label="Help" current={pathname.startsWith("/help")} />
                <li>
                  <TakeTourButton />
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className={cn("flex items-center gap-2.5 rounded-lg p-1", collapsed && "justify-center")}>
          <Avatar className="size-8 shrink-0 ring-2 ring-sidebar-primary/70 ring-offset-2 ring-offset-sidebar">
            <AvatarFallback className="text-xs font-semibold">{initials(user.name)}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] leading-tight font-semibold">{user.name}</p>
              <p className="truncate text-xs leading-tight text-sidebar-foreground/75">{roleLabel(user.role)}</p>
            </div>
          )}
          <form action={logoutAction}>
            <PushTokenField />
            <button type="submit" aria-label="Sign out" title="Sign out" className="flex size-9 items-center justify-center rounded-md text-sidebar-foreground/75 outline-hidden ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2">
              <LogOut aria-hidden className="size-4" />
            </button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function FooterLink({ href, icon: Icon, label, current }: { href: string; icon: typeof Settings; label: string; current: boolean }) {
  return (
    <li>
      <Link
        href={href}
        data-nav-item
        aria-current={current ? "page" : undefined}
        className={cn("flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm outline-hidden ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2", current && "bg-sidebar-accent font-medium")}
      >
        <Icon aria-hidden className="size-4" />
        {label}
      </Link>
    </li>
  );
}
