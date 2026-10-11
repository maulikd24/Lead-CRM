"use client";

import { useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

import { SPACES } from "@/lib/nav-items";
import { navEntriesFor, railFor } from "@/lib/nav/model";
import { markTourSeenAction } from "@/app/(dashboard)/actions";
import type { Role } from "@/generated/prisma/client";
import { BRAND } from "@/lib/brand";

const SESSION_GUARD_KEY = "supportify:tourStarted";

export function AppTour({ role, hasSeenTour, flags = [] }: { role: Role; hasSeenTour: boolean; flags?: string[] }) {
  useEffect(() => {
    if (hasSeenTour) return;

    // Guards against React Strict Mode's dev-only double effect invocation
    // (and Fast Refresh remounts) creating two overlapping tour instances.
    // Harmless in production, where effects only ever run once per mount.
    try {
      if (window.sessionStorage.getItem(SESSION_GUARD_KEY)) return;
      window.sessionStorage.setItem(SESSION_GUARD_KEY, "1");
    } catch {
      // sessionStorage unavailable (e.g. private browsing) — fall through and show the tour anyway.
    }

    // One step per workspace on the rail: the same workspaces the person sees, nothing they cannot open.
    const spaces = railFor(navEntriesFor(role, flags));

    const steps: DriveStep[] = [
      {
        popover: {
          title: `Welcome to ${BRAND.name}`,
          description: "Here's a quick look at where everything lives. You'll only see this once.",
        },
      },
      ...spaces.map((r) => ({
        element: `[data-tour-space="${r.space}"]`,
        popover: { title: SPACES[r.space].label, description: SPACES[r.space].blurb },
      })),
      {
        popover: {
          title: "That's it!",
          description: "You can revisit all of this any time from the Help link at the bottom of the sidebar.",
        },
      },
    ];

    const tour = driver({
      showProgress: true,
      steps,
      onDestroyed: () => {
        markTourSeenAction().catch(() => {});
      },
    });

    // No cleanup on purpose: the sessionStorage guard above already dedupes Strict Mode's second run,
    // so cancelling this timer on that simulated unmount would mean the tour never starts in dev.
    window.setTimeout(() => tour.drive(), 100);
  }, [hasSeenTour, role, flags]);

  return null;
}
