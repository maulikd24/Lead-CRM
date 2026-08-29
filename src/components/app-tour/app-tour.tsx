"use client";

import { useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

import { NAV_ITEMS } from "@/lib/nav-items";
import { markTourSeenAction } from "@/app/(dashboard)/actions";
import type { Role } from "@/generated/prisma/client";

const NAV_DESCRIPTIONS: Record<string, string> = {
  "/dashboard": "Your personal landing page — today's KPIs and a queue of pending work that needs your attention.",
  "/copilot": "A prioritized worklist that tells you which clients need attention right now and what to do next.",
  "/clients": "The master pipeline list — filter, search, and open any client's workspace to move them forward.",
  "/tasks": "Every to-do across your clients in one place, with due dates and one-click complete.",
  "/journeys": "Build automations — a trigger, followed by actions/conditions/waits, that run for you automatically.",
  "/reports": "Funnel, conversion, bottleneck, and RM performance analytics for the whole pipeline.",
  "/exceptions": "Everything needing manager intervention — SLA breaches, stuck clients, rejections, and missing next actions in one queue.",
  "/settings/stages": "Configure SLA targets and enable/disable steps in the onboarding pipeline.",
  "/settings/templates": "Manage approved WhatsApp/SMS message templates used for client outreach.",
  "/settings/users": "Create accounts, set roles and managers, and manage RM workload capacity.",
  "/settings/integrations": "Connect Freshdesk, Exotel, Clevertap, WhatsApp, SMS, and email — mock by default.",
  "/settings/account": "Your own profile details and password.",
  "/help": "Come back here any time for a full written guide to every feature.",
};

const SESSION_GUARD_KEY = "supportify:tourStarted";

export function AppTour({ role, hasSeenTour }: { role: Role; hasSeenTour: boolean }) {
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

    const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

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
          description: NAV_DESCRIPTIONS[item.href] ?? "",
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

    tour.drive();
  }, [hasSeenTour, role]);

  return null;
}
