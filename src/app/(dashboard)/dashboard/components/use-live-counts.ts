"use client";

import { useEffect, useRef } from "react";

import { nextPollDelay } from "@/lib/dashboard/live-funnel";
import type { LiveCounts } from "@/lib/dashboard/live-counts";

/** Polls the live-counts route only while the tab is visible; backs off after failures. */
export function useLiveCounts(onData: (counts: LiveCounts) => void, enabled = true) {
  const cb = useRef(onData);
  useEffect(() => {
    cb.current = onData;
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, nextPollDelay(failures));
    };
    const tick = async () => {
      if (document.visibilityState !== "visible") return; // resumes on visibilitychange
      try {
        const res = await fetch("/api/dashboard/live-counts", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        cb.current((await res.json()) as LiveCounts);
        failures = 0;
      } catch {
        failures += 1;
      }
      schedule();
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void tick();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
