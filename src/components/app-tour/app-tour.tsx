"use client";

import { useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

import { visibleNavItems } from "@/lib/nav-items";
import { NAV_DESCRIPTIONS } from "@/lib/nav-descriptions";
import { EXPAND_NAV_EVENT } from "@/components/app-sidebar";
import { markTourSeenAction } from "@/app/(dashboard)/actions";
import type { Role } from "@/generated/prisma/client";

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

    const visibleItems = visibleNavItems(role, flags).filter((item) => NAV_DESCRIPTIONS[item.href]); // same items as the sidebar; no blank tour steps

    const steps: DriveStep[] = [
      {
        popover: {
          title: "Welcome to Supportify",
          description: "Here's a quick look at where everything lives. You'll only see this once.",
        },
      },
      ...visibleItems.map((item) => ({
        element: `[data-tour-nav="${item.href}"]`,
        popover: {
          title: item.label,
          description: NAV_DESCRIPTIONS[item.href],
        },
      })),
      {
        popover: {
          title: "That's it!",
          description: "You can revisit all of this any time from the Help page in the sidebar.",
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

    // Sidebar items inside collapsed categories aren't in the DOM, so open every category first and
    // give React a frame to render them before the tour looks for its highlight targets.
    window.dispatchEvent(new Event(EXPAND_NAV_EVENT));
    // No cleanup on purpose: the sessionStorage guard above already dedupes Strict Mode's second run,
    // so cancelling this timer on that simulated unmount would mean the tour never starts in dev.
    window.setTimeout(() => tour.drive(), 100);
  }, [hasSeenTour, role, flags]);

  return null;
}
