"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnableCallSyncDialog } from "@/components/device-sync/enable-call-sync-dialog";
import { getCallLogPlugin } from "@/lib/device/plugin";
import { formatIstDateTime } from "@/lib/utils/ist-date";
import { revokeDeviceAction } from "./device-actions";

export type DeviceRow = { id: string; label: string; lastSyncAt: string | null; lastSyncMatched: number; createdAt: string };

export function DeviceSyncCard({ devices }: { devices: DeviceRow[] }) {
  const router = useRouter();
  const [isNative, setIsNative] = useState(false);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getCallLogPlugin()
      ?.status()
      .then((s) => {
        setIsNative(true);
        setThisDeviceId(s.deviceId);
      })
      .catch(() => {});
  }, [devices.length]);

  function disconnect(id: string) {
    startTransition(async () => {
      try {
        await revokeDeviceAction(id);
        if (id === thisDeviceId) await getCallLogPlugin()?.disconnect();
        toast.success("Call sync turned off for that device");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't disconnect");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {devices.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No phone is syncing calls yet. Install the Supportify Android app (Help → Install on your phone) and turn it on there.
        </p>
      )}
      {devices.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              {d.label} {d.id === thisDeviceId && <Badge variant="outline">This phone</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              {d.lastSyncAt ? `Last synced ${formatIstDateTime(new Date(d.lastSyncAt))} · ${d.lastSyncMatched} new client call(s)` : "Not synced yet"}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => disconnect(d.id)}>
            Disconnect
          </Button>
        </div>
      ))}
      {isNative && !thisDeviceId && (
        <>
          <Button size="sm" className="w-fit" onClick={() => setOpen(true)}>
            Turn on call sync for this phone
          </Button>
          <EnableCallSyncDialog open={open} onOpenChange={setOpen} />
        </>
      )}
    </div>
  );
}
