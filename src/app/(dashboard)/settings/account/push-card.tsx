"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from "@/lib/notifications/describe";
import { sendTestPushAction, updatePushPreferencesAction } from "./push-actions";

const CATEGORIES = Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[];

export function PushCard({ deviceCount, muted }: { deviceCount: number; muted: string[] }) {
  const [mutedSet, setMutedSet] = useState<Set<string>>(new Set(muted));
  const [pending, startTransition] = useTransition();

  function toggle(category: string, enabled: boolean) {
    const next = new Set(mutedSet);
    if (enabled) next.delete(category);
    else next.add(category);
    setMutedSet(next);
    startTransition(async () => {
      try {
        await updatePushPreferencesAction([...next]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't save");
      }
    });
  }

  function sendTest() {
    startTransition(async () => {
      try {
        const result = await sendTestPushAction();
        if (result.devices === 0) toast.error("No phone is registered yet — open the Supportify Android app and allow notifications.");
        else if (!result.configured) toast.error("Push isn't set up on the server yet (Firebase key missing). Ask an Admin.");
        else if (result.sent > 0) toast.success(`Sent to ${result.sent} phone${result.sent === 1 ? "" : "s"} — it should arrive in a few seconds.`);
        else toast.error("Couldn't deliver the test notification. Reopen the app and try again.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't send the test");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {deviceCount > 0
          ? `${deviceCount} phone${deviceCount === 1 ? " is" : "s are"} receiving alerts.`
          : "No phone is registered yet. Install the Supportify Android app (Help → Install on your phone) and allow notifications."}
      </p>
      <div className="flex flex-col gap-2">
        {CATEGORIES.map((category) => (
          <label key={category} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>{NOTIFICATION_CATEGORY_LABELS[category]}</span>
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={!mutedSet.has(category)}
              onChange={(e) => toggle(category, e.target.checked)}
              disabled={pending}
            />
          </label>
        ))}
      </div>
      <Button variant="outline" size="sm" className="w-fit" onClick={sendTest} disabled={pending}>
        Send test notification
      </Button>
    </div>
  );
}
