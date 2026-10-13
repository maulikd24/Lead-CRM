"use client";

import { PlayCircle } from "lucide-react";

import { TOUR_START_EVENT } from "@/lib/tour/machine";

/** Asks the mounted walkthrough to start from the first screen, whether or not it was seen before. */
export function requestTour() {
  window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
}

/** The replay item in the sidebar footer. */
export function TakeTourButton() {
  return (
    <button
      type="button"
      data-nav-item
      onClick={requestTour}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-hidden ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2"
    >
      <PlayCircle aria-hidden className="size-4" />
      Take the tour
    </button>
  );
}
