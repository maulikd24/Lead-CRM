import "@/lib/policy/approvals/registry-init";

import { cookies } from "next/headers";

import { requireUser } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { notificationVisibleWhere } from "@/lib/access/notification-policy";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTourLoader } from "@/components/app-tour/app-tour-loader";
import { DemoBanner } from "@/components/demo-banner";
import { NotificationsBell } from "@/components/notifications-bell";
import { SlaNotificationPoller } from "@/components/sla-notification-poller";
import { OwnCompletionCelebration } from "./dashboard/components/funded-celebration";
import { ReportIssueDialog } from "@/components/report-issue-dialog";
import { CommandPalette } from "@/components/command-palette";
import { GlobalShortcuts } from "@/components/shell/global-shortcuts";
import { HelpMenu } from "@/components/shell/help-menu";
import { NewMenu } from "@/components/shell/new-menu";
import { PageViewTracker } from "@/components/page-view-tracker";
import { DeviceSyncSetup } from "@/components/device-sync/device-sync-setup";
import { PushSetup } from "@/components/device-sync/push-setup";
import { DEVICE_SYNC_ROLES } from "@/lib/device/token";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { enabledNavFlags } from "@/lib/nav-flags";
import { navSetupNeeded } from "@/lib/nav/setup";
import { ThemeSwitch } from "@/components/theme-switch";
import { PageEnter } from "@/components/wow/page-enter";
import { getNavCounts } from "@/lib/wow/nav-counts";
import { railCookieName } from "@/lib/wow/nav-sections";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();

  const [unreadCount, navCounts, jar, me] = await Promise.all([
    prisma.notification.count({
      where: { userId: session.user.id, readAt: null, ...notificationVisibleWhere(session.user.role) },
    }),
    getNavCounts(session.user.id, session.user.role),
    cookies(),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { hasSeenTour: true } }),
  ]);
  // The rail (expanded or icon-only) is remembered per person, in a cookie the server can read, so there is no flash on load.
  const railCookie = railCookieName(session.user.id);
  const railOpen = jar.get(railCookie)?.value !== "false";
  const flags = enabledNavFlags();

  return (
    <SidebarProvider defaultOpen={railOpen} cookieName={railCookie}>
      <PageViewTracker />
      <PushSetup />
      <DeviceSyncSetup eligible={DEVICE_SYNC_ROLES.includes(session.user.role)} />
      <AppSidebar user={session.user} flags={enabledNavFlags()} counts={navCounts} setupNeeded={session.user.role === "ADMIN" ? navSetupNeeded(enabledNavFlags()) : []} />
      {/* The walkthrough lives in the layout, so it keeps its place while it opens each screen in turn. */}
      <AppTourLoader role={session.user.role} hasSeenTour={me?.hasSeenTour ?? true} flags={enabledNavFlags()} />
      <GlobalShortcuts role={session.user.role} flags={flags} />
      <SidebarInset>
        <DemoBanner />
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <CommandPalette role={session.user.role} flags={enabledNavFlags()} userId={session.user.id} />
          {/* One cluster, in order of use: create, help, theme, report, notifications. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <NewMenu role={session.user.role} flags={flags} />
            <SlaNotificationPoller role={session.user.role} />
            <OwnCompletionCelebration userId={session.user.id} />
            <HelpMenu role={session.user.role} />
            <ThemeSwitch />
            <ReportIssueDialog />
            <NotificationsBell unreadCount={unreadCount} />
          </div>
        </header>
        <main className="flex flex-1 flex-col p-6">
          <PageEnter className="flex flex-1 flex-col gap-4">{children}</PageEnter>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
