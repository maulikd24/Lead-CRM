"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { markTourSeenAction } from "@/app/(dashboard)/actions";
import type { Role } from "@/generated/prisma/client";
import { isStepOpen, shouldAutoStart, tourStepsFor } from "@/lib/tour/steps";
import { TOUR_IDLE, TOUR_START_EVENT, tourBack, tourNext, tourSkip, tourStart, type TourState } from "@/lib/tour/machine";
import { cn } from "@/lib/utils";

/**
 * The guided walkthrough. It starts on first sign-in (hasSeenTour is false) and again whenever "Take the tour" is pressed. Each step opens
 * one screen the person's role can open, then explains it in a card with Back, Next and Skip. Escape skips. Finishing or skipping saves
 * hasSeenTour. The card does not block the page, so the screen stays readable while the tour runs.
 */
export function AppTour({ role, hasSeenTour, flags = [] }: { role: Role; hasSeenTour: boolean; flags?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const steps = useMemo(() => tourStepsFor(role, flags), [role, flags]);
  const [tour, setTour] = useState<TourState>(TOUR_IDLE);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const autoStarted = useRef(false);
  const here = useRef({ pathname, search });
  useEffect(() => { here.current = { pathname, search }; });
  const titleId = useId();
  const bodyId = useId();

  const begin = useCallback(() => {
    if (steps.length === 0) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTour(tourStart(steps.length));
  }, [steps.length]);

  // Starts once on first sign-in. The ref survives React Strict Mode's double effect in development, so the tour is never started twice.
  useEffect(() => {
    if (autoStarted.current || !shouldAutoStart(hasSeenTour, steps.length)) return;
    autoStarted.current = true;
    begin();
  }, [hasSeenTour, steps.length, begin]);

  // The replay item in the sidebar footer.
  useEffect(() => {
    window.addEventListener(TOUR_START_EVENT, begin);
    return () => window.removeEventListener(TOUR_START_EVENT, begin);
  }, [begin]);

  const running = tour.status === "running";
  const index = tour.status === "running" ? tour.index : 0;
  const step = running ? steps[index] : undefined;

  // Each step opens its screen. The card stays mounted in the dashboard layout, so it survives the page change.
  useEffect(() => {
    if (!step) return;
    const current = here.current;
    if (!isStepOpen(step.href, current.pathname, current.search)) router.push(step.href);
    // Only a change of step navigates. Re-running on every URL change would loop when a screen redirects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, index]);

  // Focus moves into the card when it opens and at each step, so a screen reader announces the new step.
  useEffect(() => {
    if (running) cardRef.current?.focus();
  }, [running, index]);

  const markSeen = useCallback(() => {
    markTourSeenAction().catch(() => {});
  }, []);

  const close = useCallback(() => {
    setTour(TOUR_IDLE);
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target && document.contains(target)) target.focus();
  }, []);

  const next = useCallback(() => {
    const { state, effect } = tourNext(tour);
    if (effect === "mark-seen") {
      markSeen();
      close();
    } else {
      setTour(state);
    }
  }, [tour, markSeen, close]);

  const back = useCallback(() => setTour((s) => tourBack(s).state), []);

  const skip = useCallback(() => {
    const { effect } = tourSkip(tour);
    if (effect === "mark-seen") {
      markSeen();
      close();
    }
  }, [tour, markSeen, close]);

  // Escape skips from anywhere on the page while the tour runs.
  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, skip]);

  if (!step || tour.status !== "running") return null;
  const total = tour.total;
  const last = index === total - 1;
  const percent = Math.round(((index + 1) / total) * 100);

  return (
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-hidden"
      >
        <p className="text-xs font-medium text-muted-foreground">{step.where}</p>
        <h2 id={titleId} className="font-heading text-base leading-snug font-semibold">{step.title}</h2>
        <p id={bodyId} className="text-sm leading-relaxed">{step.purpose}</p>
        <p className="text-sm leading-relaxed">
          <span className="font-semibold">Try it: </span>
          {step.tryThis}
        </p>
        <div className="flex flex-col gap-1.5">
          <div role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1} aria-valuetext={`Step ${index + 1} of ${total}`} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{`Step ${index + 1} of ${total}`}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={skip} className={cn(buttonClass, "text-muted-foreground")}>
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={back} disabled={index === 0} className={cn(buttonClass, "border bg-background hover:bg-muted disabled:opacity-50")}>
              Back
            </button>
            <button type="button" onClick={next} className={cn(buttonClass, "bg-primary text-primary-foreground hover:bg-primary/90")}>
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
        <p aria-live="polite" className="sr-only">{`Step ${index + 1} of ${total}: ${step.title}`}</p>
      </div>
  );
}

const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none";
