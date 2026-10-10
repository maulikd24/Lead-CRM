import { describe, expect, it } from "vitest";

import { canAskManager, reviewKeyAction, skipTarget } from "./review-model";

describe("reviewKeyAction", () => {
  it("maps the documented keys", () => {
    expect(reviewKeyAction({ key: "j" })).toBe("next");
    expect(reviewKeyAction({ key: "k" })).toBe("prev");
    expect(reviewKeyAction({ key: "1" })).toBe("keep-first");
    expect(reviewKeyAction({ key: "2" })).toBe("keep-second");
    expect(reviewKeyAction({ key: "m" })).toBe("merge");
    expect(reviewKeyAction({ key: "s" })).toBe("skip");
    expect(reviewKeyAction({ key: "d" })).toBe("dismiss");
  });
  it("ignores other keys and anything with a modifier (Ctrl+S saves the page, Cmd+M minimises)", () => {
    expect(reviewKeyAction({ key: "x" })).toBeNull();
    expect(reviewKeyAction({ key: "Enter" })).toBeNull();
    for (const mod of ["metaKey", "ctrlKey", "altKey"] as const) expect(reviewKeyAction({ key: "s", [mod]: true })).toBeNull();
  });
});

describe("skipTarget", () => {
  it("moves to the next suggestion and wraps after the last", () => {
    expect(skipTarget(0, 3)).toBe(1);
    expect(skipTarget(2, 3)).toBe(0);
  });
  it("has nowhere to go with one or no suggestions", () => {
    expect(skipTarget(0, 1)).toBeNull();
    expect(skipTarget(0, 0)).toBeNull();
  });
  it("treats an unknown selection as before the first", () => {
    expect(skipTarget(-1, 3)).toBe(1);
  });
});

describe("canAskManager", () => {
  it("is offered to a relationship manager on a cross-owner pair only", () => {
    expect(canAskManager("RM", true)).toBe(true);
    expect(canAskManager("RM", false)).toBe(false);
  });
  it("is never offered to someone who can merge directly", () => {
    expect(canAskManager("MANAGER", true)).toBe(false);
    expect(canAskManager("ADMIN", true)).toBe(false);
  });
});
