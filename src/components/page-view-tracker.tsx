"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Reports each page the signed-in user opens (pathname only) to the activity log. */
export function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    const now = Date.now();
    // Same path again within 2s = StrictMode/double-render, not a real visit.
    if (last.current && last.current.path === pathname && now - last.current.at < 2000) return;
    last.current = { path: pathname, at: now };

    fetch("/api/activity/page-view", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
