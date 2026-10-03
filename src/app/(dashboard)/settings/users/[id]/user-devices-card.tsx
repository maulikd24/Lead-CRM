"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatIstDateTime } from "@/lib/utils/ist-date";
import { revokeDeviceAction } from "../../account/device-actions";

export type UserDeviceRow = { id: string; label: string; lastSyncAt: string | null; lastSyncMatched: number; appVersion: string | null };

export function UserDevicesCard({ devices }: { devices: UserDeviceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (devices.length === 0) return <p className="text-sm text-muted-foreground">No phone is syncing calls for this user.</p>;
  return (
    <div className="flex flex-col gap-2">
      {devices.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div>
            <p className="font-medium">
              {d.label}
              {d.appVersion ? <span className="ml-2 text-xs text-muted-foreground">app v{d.appVersion}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {d.lastSyncAt ? `Last synced ${formatIstDateTime(new Date(d.lastSyncAt))} · ${d.lastSyncMatched} new client call(s)` : "Not synced yet"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await revokeDeviceAction(d.id);
                  toast.success("Device disconnected");
                  router.refresh();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't revoke");
                }
              })
            }
          >
            Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}
