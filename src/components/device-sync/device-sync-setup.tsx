"use client";

import { useEffect, useState } from "react";

import { getCallLogPlugin } from "@/lib/device/plugin";
import { EnableCallSyncDialog } from "./enable-call-sync-dialog";

const DECLINED_KEY = "supportify:callSyncDeclined";

/**
 * Mounted once in the dashboard layout. Does nothing in a normal browser; inside the Android app it
 * offers call sync on first use (until declined) for roles that own clients.
 */
export function DeviceSyncSetup({ eligible }: { eligible: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    const plugin = getCallLogPlugin();
    if (!plugin) return;
    try {
      if (localStorage.getItem(DECLINED_KEY)) return;
    } catch {
      // storage blocked — fall through and ask
    }
    plugin
      .status()
      .then((s) => {
        if (!s.hasToken) setOpen(true);
        else void plugin.syncNow(); // app opened/resumed — catch up immediately
      })
      .catch(() => {});
  }, [eligible]);

  if (!eligible) return null;
  return (
    <EnableCallSyncDialog
      open={open}
      onOpenChange={setOpen}
      onDeclined={() => {
        try {
          localStorage.setItem(DECLINED_KEY, "1");
        } catch {}
      }}
    />
  );
}
