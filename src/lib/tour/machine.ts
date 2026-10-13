/**
 * The tour's state, as pure transitions. A transition that ends the tour (finish or skip) returns `"mark-seen"`, and the component then
 * saves hasSeenTour through the user update path. Back, Next in the middle and starting never save anything.
 */
export type TourState = { status: "idle" } | { status: "running"; index: number; total: number };

export type TourEffect = "mark-seen" | null;

export const TOUR_IDLE: TourState = { status: "idle" };

export function tourStart(total: number): TourState {
  return total > 0 ? { status: "running", index: 0, total } : TOUR_IDLE;
}

/** Next moves on; from the last step it finishes the tour. */
export function tourNext(state: TourState): { state: TourState; effect: TourEffect } {
  if (state.status !== "running") return { state, effect: null };
  if (state.index >= state.total - 1) return { state: TOUR_IDLE, effect: "mark-seen" };
  return { state: { ...state, index: state.index + 1 }, effect: null };
}

/** Back moves to the previous step; on the first step it stays put. */
export function tourBack(state: TourState): { state: TourState; effect: TourEffect } {
  if (state.status !== "running" || state.index === 0) return { state, effect: null };
  return { state: { ...state, index: state.index - 1 }, effect: null };
}

/** Skip and Escape both end the tour early, and that also counts as seen. */
export function tourSkip(state: TourState): { state: TourState; effect: TourEffect } {
  if (state.status !== "running") return { state, effect: null };
  return { state: TOUR_IDLE, effect: "mark-seen" };
}

/** The window event the "Take the tour" item fires to replay the tour. */
export const TOUR_START_EVENT = "supportify:start-tour";
