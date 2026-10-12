"use client";

import { useEffect, useRef, useState } from "react";

import { createPoller, type PollStatus } from "@/lib/dashboard/live-poller";
import type { LiveCounts } from "@/lib/dashboard/live-counts";

async function fetchCounts(signal: AbortSignal): Promise<LiveCounts> {
  const res = await fetch("/api/dashboard/live-counts", { cache: "no-store", credentials: "same-origin", signal });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as LiveCounts;
}

/** Polls the live-counts route while the tab is visible (see createPoller for the guarantees). Returns the poll status. */
export function useLiveCounts(onData: (counts: LiveCounts) => void, enabled = true): PollStatus {
  const cb = useRef(onData);
  const [status, setStatus] = useState<PollStatus>("live");
  useEffect(() => {
    cb.current = onData;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller({
      fetchCounts,
      onData: (c) => cb.current(c),
      onStatus: setStatus,
      isVisible: () => document.visibilityState === "visible",
    });
    const onVisibility = () => poller.visibilityChanged();
    poller.start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      poller.stop();
    };
  }, [enabled]);

  return status;
}
