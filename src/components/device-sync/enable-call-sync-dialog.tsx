"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { registerDeviceAction } from "@/app/(dashboard)/settings/account/device-actions";
import { getCallLogPlugin } from "@/lib/device/plugin";

/**
 * Consent + setup flow for Android call-log sync: explain exactly what is uploaded, get the OS
 * permission, mint a per-device token, hand it to the native plugin and start syncing.
 */
export function EnableCallSyncDialog({
  open,
  onOpenChange,
  onDeclined,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeclined?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [permissionBlocked, setPermissionBlocked] = useState(false);

  async function enable() {
    const plugin = getCallLogPlugin();
    if (!plugin) {
      toast.error("Call sync is only available in the Supportify Android app");
      return;
    }
    setPending(true);
    try {
      const { granted } = await plugin.requestPermission();
      if (!granted) {
        setPermissionBlocked(true);
        return;
      }
      setPermissionBlocked(false);
      const status = await plugin.status();
      const { token, deviceId } = await registerDeviceAction("Android phone", status.appVersion);
      await plugin.configure({ token, deviceId, baseUrl: window.location.origin });
      await plugin.schedulePeriodic();
      await plugin.syncNow();
      toast.success("Call sync is on — calls with your clients will appear in their Activity.");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't turn on call sync");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sync calls with your clients?</DialogTitle>
          <DialogDescription>
            Supportify can read this phone&apos;s call log and add your calls with clients to their Activity timeline.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Only calls to or from your assigned clients&apos; numbers are saved: the time, direction and duration.</li>
          <li>All other calls — personal calls included — are checked and thrown away. They are never stored.</li>
          <li>The first sync covers the last 30 days; after that it syncs when you open the app and about every 15 minutes.</li>
          <li>You can switch this off any time under Settings → Phone call sync.</li>
        </ul>
        {permissionBlocked && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-medium">Android blocked the call-log permission.</p>
            <p className="mt-1 text-muted-foreground">
              Because this app was installed from a file, Android 13+ needs one extra step: open App settings → tap ⋮ (top right) →{" "}
              <b>Allow restricted settings</b>, then go to Permissions → Call logs → Allow. Then tap Allow &amp; sync again.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void getCallLogPlugin()?.openAppSettings()}>
              Open App settings
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onDeclined?.();
              onOpenChange(false);
            }}
          >
            Not now
          </Button>
          <Button onClick={enable} disabled={pending}>
            {pending ? "Setting up…" : "Allow & sync"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
