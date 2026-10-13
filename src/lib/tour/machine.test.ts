import { describe, expect, it } from "vitest";

import { TOUR_IDLE, TOUR_START_EVENT, tourBack, tourNext, tourSkip, tourStart } from "./machine";

describe("tour transitions", () => {
  it("starts on the first step of a non-empty tour, and stays idle for an empty one", () => {
    expect(tourStart(3)).toEqual({ status: "running", index: 0, total: 3 });
    expect(tourStart(0)).toEqual(TOUR_IDLE);
  });

  it("Next moves on without saving anything", () => {
    const r = tourNext(tourStart(3));
    expect(r.state).toEqual({ status: "running", index: 1, total: 3 });
    expect(r.effect).toBeNull();
  });

  it("Back moves to the previous step, and stays on the first step", () => {
    const second = tourNext(tourStart(3)).state;
    expect(tourBack(second).state).toEqual({ status: "running", index: 0, total: 3 });
    const first = tourStart(3);
    expect(tourBack(first).state).toEqual(first);
    expect(tourBack(first).effect).toBeNull();
  });

  it("Finish on the last step ends the tour and sets hasSeenTour", () => {
    let state = tourStart(2);
    state = tourNext(state).state;
    const r = tourNext(state);
    expect(r.state).toEqual(TOUR_IDLE);
    expect(r.effect).toBe("mark-seen");
  });

  it("Skip ends the tour early and sets hasSeenTour, from any step", () => {
    const r = tourSkip(tourStart(5));
    expect(r.state).toEqual(TOUR_IDLE);
    expect(r.effect).toBe("mark-seen");
  });

  it("Skip or Next on an idle tour does nothing", () => {
    expect(tourSkip(TOUR_IDLE)).toEqual({ state: TOUR_IDLE, effect: null });
    expect(tourNext(TOUR_IDLE)).toEqual({ state: TOUR_IDLE, effect: null });
  });

  it("replay uses a named window event", () => {
    expect(TOUR_START_EVENT).toBe("supportify:start-tour");
  });
});
