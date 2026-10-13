import { allModules, navEntriesFor } from "@/lib/nav/model";
import { NAV_DESCRIPTIONS } from "@/lib/nav-descriptions";
import type { Role } from "@/generated/prisma/client";
import { TRY_THIS } from "./try-this";

export type TourStep = {
  /** The screen this step opens, exactly as the nav item links to it. */
  href: string;
  /** The screen's name, as the sidebar shows it. */
  title: string;
  /** The workspace and group it sits in, for example "Customers · People". */
  where: string;
  /** What the screen is for, in one plain sentence. */
  purpose: string;
  /** One thing to try on the screen. */
  tryThis: string;
};

/**
 * The tour for one role: one step per screen the role can open, in the same order the sidebar shows them. An item that is switched off
 * is not a screen the person can open, so it gets no step. Built only from the nav model and the access policy, so a role never sees a
 * step for a screen it cannot reach.
 */
export function tourStepsFor(role: Role, flags: readonly string[]): TourStep[] {
  const entries = navEntriesFor(role, flags);
  const seen = new Set<string>();
  const steps: TourStep[] = [];
  for (const mod of allModules(entries)) {
    for (const group of mod.groups) {
      for (const entry of group.entries) {
        if (entry.state === "off" || seen.has(entry.href)) continue;
        seen.add(entry.href);
        steps.push({
          href: entry.href,
          title: entry.label,
          where: `${mod.label} · ${group.group}`,
          purpose: NAV_DESCRIPTIONS[entry.href] ?? "Open this screen to see what it shows.",
          tryThis: TRY_THIS[entry.href] ?? "Open this screen and look around.",
        });
      }
    }
  }
  return steps;
}

/** The tour starts on first sign-in only: a person who has seen it (or finished or skipped it) is not shown it again. */
export function shouldAutoStart(hasSeenTour: boolean, stepCount: number): boolean {
  return !hasSeenTour && stepCount > 0;
}

/** True when the screen the browser is on is the one a step opens: same path, and every query parameter the step names matches. */
export function isStepOpen(href: string, pathname: string, search: string): boolean {
  const [path, query = ""] = href.split("?");
  if (pathname !== path) return false;
  const current = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(query)) {
    if (current.get(key) !== value) return false;
  }
  return true;
}
