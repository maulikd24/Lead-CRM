import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CountUp, formatRemaining, SlaBar, SlaRing, SlaStyles } from "./sla-visuals";

const now = new Date("2026-10-07T12:00:00Z");

describe("formatRemaining", () => {
  it("formats future and past", () => {
    expect(formatRemaining(90 * 60_000)).toBe("due in 1h 30m");
    expect(formatRemaining(-5 * 60_000)).toBe("overdue by 5m");
    expect(formatRemaining(3 * 86_400_000)).toBe("due in 3d");
  });
});

describe("SlaBar", () => {
  it("shows state in words and exposes progressbar semantics", () => {
    const out = renderToStaticMarkup(<SlaBar label="Resolution" start={new Date("2026-10-07T08:00:00Z")} due={new Date("2026-10-07T11:00:00Z")} now={now} />);
    expect(out).toContain("Breached");
    expect(out).toContain("overdue by 1h 0m");
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="100"');
    expect(out).toContain("var(--destructive)");
  });
  it("shows Met when done in time and omits the countdown", () => {
    const out = renderToStaticMarkup(<SlaBar label="First response" start={new Date("2026-10-07T08:00:00Z")} due={new Date("2026-10-07T14:00:00Z")} now={now} doneAt={new Date("2026-10-07T09:00:00Z")} />);
    expect(out).toContain("Met");
    expect(out).not.toContain("due in");
  });
});

describe("CountUp and SlaRing", () => {
  it("keeps the final number readable without CSS", () => {
    expect(renderToStaticMarkup(<CountUp value={67} suffix="%" />)).toContain("67%");
  });
  it("ring labels compliance and handles no data", () => {
    expect(renderToStaticMarkup(<SlaRing pct={88} />)).toContain("SLA compliance: 88 percent");
    const none = renderToStaticMarkup(<SlaRing pct={null} />);
    expect(none).toContain("no data yet");
    expect(none).not.toContain("fd-ring-arc");
  });
});

describe("SlaStyles", () => {
  it("animates only when reduced motion is not requested", () => {
    const css = renderToStaticMarkup(<SlaStyles />);
    const [stat, anim] = css.split("@media (prefers-reduced-motion: no-preference)");
    expect(anim).toContain("animation:");
    expect(stat).not.toMatch(/animation:/);
  });
});
