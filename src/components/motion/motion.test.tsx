import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

import { DURATION, EASE, STAGGER } from "./tokens";
import { readReducedMotion } from "./use-reduced-motion";
import { formatCount } from "./format-count";
import { chartMotionProps } from "./draw-in";
import { shouldFireConfetti, markFired, _resetFired } from "./confetti";
import { CountUp, tweenValue } from "./count-up";
import { FadeIn, Stagger, StaggerItem } from "./fade-in";
import { Pulse } from "./pulse";
import { PageTransition } from "./page-transition";
import { DrawIn, DrawPath } from "./draw-in";

describe("tokens", () => {
  it("keeps durations short and ordered", () => {
    expect(DURATION.fast).toBeLessThan(DURATION.base);
    expect(DURATION.base).toBeLessThan(DURATION.slow);
    expect(EASE.out).toHaveLength(4);
    expect(STAGGER).toBeGreaterThan(0);
  });
});

describe("readReducedMotion", () => {
  it("is false without matchMedia (server)", () => {
    expect(readReducedMotion(undefined)).toBe(false);
  });
  it("reflects the media query", () => {
    expect(readReducedMotion(() => ({ matches: true }) as MediaQueryList)).toBe(true);
    expect(readReducedMotion(() => ({ matches: false }) as MediaQueryList)).toBe(false);
  });
});

describe("formatCount", () => {
  it("formats Indian grouping", () => {
    expect(formatCount(1234567, "number")).toBe("12,34,567");
  });
  it("formats rupees, compact and percent", () => {
    expect(formatCount(1234567, "inr")).toBe("₹12,34,567");
    expect(formatCount(25000000, "inr-compact")).toBe("₹2.50 Cr");
    expect(formatCount(250000, "inr-compact")).toBe("₹2.50 L");
    expect(formatCount(42.4, "percent")).toBe("42%");
  });
  it("honours decimals", () => {
    expect(formatCount(12.345, "number", 1)).toBe("12.3");
  });
});

describe("chartMotionProps", () => {
  it("disables recharts animation under reduced motion", () => {
    expect(chartMotionProps(true)).toEqual({ isAnimationActive: false });
  });
  it("uses shared tokens otherwise", () => {
    const p = chartMotionProps(false);
    expect(p.isAnimationActive).toBe(true);
    expect(p.animationDuration).toBe(Math.round(DURATION.chart * 1000));
  });
});

describe("confetti once-per-event", () => {
  it("never fires under reduced motion and only once per id", () => {
    _resetFired();
    expect(shouldFireConfetti("a", true)).toBe(false);
    expect(shouldFireConfetti("a", false)).toBe(true);
    markFired("a");
    expect(shouldFireConfetti("a", false)).toBe(false);
    expect(shouldFireConfetti("b", false)).toBe(true);
  });
});

describe("server markup is visible (no hidden initial state)", () => {
  it("page-level wrappers render without opacity:0 or transforms", () => {
    const html = renderToString(
      createElement(PageTransition, null, createElement(FadeIn, null, "a"), createElement(Stagger, null, createElement(StaggerItem, null, "b"))),
    );
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).not.toMatch(/translate/);
  });
});

describe("CountUp guards", () => {
  it("renders a dash for non-finite values instead of NaN", () => {
    const html = renderToString(createElement(CountUp, { value: NaN, format: "inr-compact" }));
    expect(html).not.toContain("NaN");
    expect(html).toContain("—");
  });
});

describe("tween", () => {
  it("eases from start to end and clamps", () => {
    expect(tweenValue(0, 100, 0)).toBe(0);
    expect(tweenValue(0, 100, 1)).toBe(100);
    expect(tweenValue(0, 100, 2)).toBe(100);
    expect(tweenValue(0, 100, 0.5)).toBeGreaterThan(50);
  });
});

describe("server render shows final values", () => {
  it("CountUp renders the final formatted value", () => {
    const html = renderToString(createElement(CountUp, { value: 1234567, format: "inr" }));
    expect(html).toContain("₹12,34,567");
    expect(html).toContain("tabular-nums");
  });
  it("wrappers render their children", () => {
    const html = renderToString(
      createElement(
        PageTransition,
        null,
        createElement(FadeIn, null, "hello"),
        createElement(Stagger, null, createElement(StaggerItem, null, "item")),
        createElement(DrawIn, null, "chart"),
        createElement("svg", null, createElement(DrawPath, { d: "M0 0L10 10" })),
        createElement(Pulse, { label: "Live" }),
      ),
    );
    for (const t of ["hello", "item", "chart", "M0 0L10 10", "Live"]) expect(html).toContain(t);
  });
});

