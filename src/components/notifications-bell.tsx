"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, CheckCheck, Clock, FileCheck, MessageSquare, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { describeNotification } from "@/lib/notifications/describe";
import { notificationKind, timeAgo, type NotificationKind } from "@/lib/wow/time-ago";
import { cn } from "@/lib/utils";
import type { Notification } from "@/generated/prisma/client";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
  getRecentNotificationsAction,
} from "@/app/(dashboard)/notifications-actions";
import styles from "./wow/wow.module.css";

const ICON: Record<NotificationKind, LucideIcon> = { task: Clock, kyc: FileCheck, funding: Wallet, lead: UserPlus, message: MessageSquare, alert: AlertTriangle, other: Bell };

/**
 * The top bar's bell: a lime dot when something is unread, and a popover list (not a menu) with an icon per kind of notification,
 * how long ago it arrived, an unread dot, Mark all read, and a toast to confirm it. Opening a row marks it read; a row that
 * belongs to a client opens that client. Escape closes it and focus returns to the bell.
 */
export function NotificationsBell({ unreadCount }: { unreadCount: number }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(unreadCount);
  const [seen, setSeen] = useState(unreadCount);
  const [, startTransition] = useTransition();
  // A fresh count from the server (after a revalidation) wins over what was counted locally.
  if (seen !== unreadCount) {
    setSeen(unreadCount);
    setUnread(unreadCount);
    setNotifications(null);
  }

  async function handleOpenChange(open: boolean) {
    if (open && notifications === null) {
      setLoading(true);
      try {
        setNotifications(await getRecentNotificationsAction());
      } catch {
        toast.error("Couldn't load notifications");
      } finally {
        setLoading(false);
      }
    }
  }

  function read(n: Notification) {
    if (!n.readAt) {
      setNotifications((list) => list?.map((x) => (x.id === n.id ? { ...x, readAt: new Date() } : x)) ?? list);
      setUnread((u) => Math.max(0, u - 1));
      startTransition(() => void markNotificationReadAction(n.id));
    }
    const clientId = (n.payload as Record<string, unknown> | null)?.clientId;
    if (typeof clientId === "string") router.push(`/clients/${clientId}`);
  }

  function readAll() {
    setNotifications((list) => list?.map((x) => (x.readAt ? x : { ...x, readAt: new Date() })) ?? list);
    setUnread(0);
    startTransition(async () => {
      await markAllNotificationsReadAction();
      toast.success("All caught up", { description: "Every notification is marked as read." });
    });
  }

  const list = notifications ?? [];
  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="relative" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
            <Bell className="size-4" aria-hidden />
            {unread > 0 && <span className={styles.bellDot} aria-hidden data-testid="bell-dot" />}
          </Button>
        }
      />
      <PopoverContent align="end">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <PopoverTitle>Notifications</PopoverTitle>
            {unread > 0 && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary-ink" style={{ color: "var(--primary-ink)" }}>{unread} new</span>}
          </div>
          <Button variant="ghost" size="xs" disabled={unread === 0} onClick={readAll}>
            <CheckCheck aria-hidden /> Mark all read
          </Button>
        </div>
        <div className="max-h-[min(26rem,70dvh)] overflow-y-auto">
          {loading && <p className="px-4 py-8 text-center text-sm text-muted-foreground" role="status">Loading…</p>}
          {!loading && list.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 px-4 py-9 text-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"><Bell className="size-4" aria-hidden /></span>
              <p className="text-sm font-medium">You are all caught up</p>
              <p className="text-xs text-muted-foreground">New activity on your clients and tasks shows up here.</p>
            </div>
          )}
          <ul className="flex flex-col py-1">
            {list.slice(0, 10).map((n) => {
              const Icon = ICON[notificationKind(n.type)];
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => read(n)} className={cn(styles.bellRow, "flex w-full items-start gap-3 px-3.5 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}>
                    <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", n.readAt ? "bg-muted text-muted-foreground" : "bg-primary/15")} style={n.readAt ? undefined : { color: "var(--primary-ink)" }}>
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[13px] leading-snug", n.readAt ? "text-muted-foreground" : "font-medium")}>{describeNotification(n)}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" role="img" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
