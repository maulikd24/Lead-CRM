import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TakeTourButton, requestTour } from "./take-tour-button";
import { TOUR_START_EVENT } from "@/lib/tour/machine";

describe("Take the tour replay item", () => {
  it("is labelled in the sidebar footer", () => {
    expect(renderToStaticMarkup(<TakeTourButton />)).toContain("Take the tour");
  });
  it("fires the replay event the walkthrough listens for", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const heard = vi.fn();
    target.addEventListener(TOUR_START_EVENT, heard);
    requestTour();
    expect(heard).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
