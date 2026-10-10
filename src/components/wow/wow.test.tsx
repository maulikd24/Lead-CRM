import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { Users } from "lucide-react";
import { describe, expect, it } from "vitest";

import { AreaChart, AreaSparkline, ChartCard, DeltaChip, KpiCard, SegmentedToggle, deltaView, thumbIndex } from "./index";
import { deltaOf, headlineOf } from "./chart-card";
import { toggleKeyTarget } from "./segmented-toggle";

const html = (el: React.ReactElement) => renderToString(el);
const css = readFileSync(path.join(__dirname, "wow.module.css"), "utf8");

describe("AreaSparkline draws only real history", () => {
  it("renders nothing without history", () => {
    expect(html(<AreaSparkline values={undefined} />)).toBe("");
    expect(html(<AreaSparkline values={[3]} />)).toBe("");
    expect(html(<AreaSparkline values={[0, 0, 0, 0]} />)).toBe("");
  });
  it("is an image with a text equivalent when there is history", () => {
    const out = html(<AreaSparkline values={[1, 3, 2, 8]} />);
    expect(out).toContain('role="img"');
    expect(out).toContain("Last 4 days: from 1 to 8");
    expect(out).toContain("<path");
  });
  it("reveals once with the shared draw class, never a loop", () => {
    expect(html(<AreaSparkline values={[1, 2]} />)).toMatch(/class="[^"]*draw/);
  });
});

describe("KpiCard", () => {
  const card = (props: Partial<React.ComponentProps<typeof KpiCard>> = {}) => html(<ul><KpiCard label="New leads" icon={Users} value={39} {...props} /></ul>);
  it("shows the label, the figure for assistive tech and an icon chip hidden from it", () => {
    const out = card();
    expect(out).toContain("New leads");
    expect(out).toContain("New leads: 39");
    expect(out).toMatch(/aria-hidden="true"[^>]*><svg|<span[^>]*aria-hidden="true"[^>]*><svg/);
  });
  it("is a list item, so it sits in a list", () => {
    expect(card()).toContain("<li");
  });
  it("has no sparkline and no delta unless it was given real ones", () => {
    const out = card();
    expect(out).not.toContain('role="img"');
    expect(out).not.toContain("vs last period");
  });
  it("shows a delta that reads aloud with its period", () => {
    const out = card({ delta: { pct: 12, direction: "up" } });
    expect(out).toContain("+12%");
    expect(out).toContain("up 12 percent vs last period");
  });
  it("draws the sparkline from the series it is given", () => {
    expect(card({ series: [1, 2, 4, 3] })).toContain('role="img"');
  });
  it("is a link when it has an href", () => {
    expect(card({ href: "/tasks" })).toContain('href="/tasks"');
  });
  it("uses a text value as given", () => {
    expect(html(<ul><KpiCard label="Biggest spender" text="₹4,200" /></ul>)).toContain("₹4,200");
  });
});

describe("delta colour follows whether the change is good news", () => {
  it("up is good for a figure that should grow", () => {
    expect(deltaView({ pct: 5, direction: "up" }).good).toBe(true);
    expect(deltaView({ pct: -5, direction: "down" }).good).toBe(false);
  });
  it("down is good for overdue, pending and cost figures", () => {
    expect(deltaView({ pct: -5, direction: "down" }, "down").good).toBe(true);
    expect(deltaView({ pct: 5, direction: "up" }, "down").good).toBe(false);
  });
  it("flat is neither", () => {
    expect(deltaView({ pct: 0, direction: "flat" }).good).toBeNull();
    expect(html(<DeltaChip delta={{ pct: 0, direction: "flat" }} />)).toContain("unchanged");
  });
});

describe("SegmentedToggle", () => {
  const options = [{ key: "a", label: "Revenue" }, { key: "b", label: "Orders" }, { key: "c", label: "Profit" }];
  const out = html(<SegmentedToggle options={options} value="b" onChange={() => {}} label="Series" />);
  it("is a named radio group with one radio per option", () => {
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-label="Series"');
    expect((out.match(/role="radio"/g) ?? []).length).toBe(3);
  });
  it("checks exactly one radio and makes it the only tab stop", () => {
    expect((out.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect((out.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((out.match(/tabindex="-1"/g) ?? []).length).toBe(2);
  });
  it("places the sliding thumb on the chosen option without measuring (server safe)", () => {
    expect(out).toContain("--i:1");
    expect(out).toContain("--n:3");
    expect(thumbIndex(options, "zzz")).toBe(0);
  });
  it("moves with the arrow keys, wraps, and jumps with Home and End", () => {
    const keys = options.map((o) => o.key);
    expect(toggleKeyTarget(keys, "a", "ArrowRight")).toBe("b");
    expect(toggleKeyTarget(keys, "c", "ArrowRight")).toBe("a");
    expect(toggleKeyTarget(keys, "a", "ArrowLeft")).toBe("c");
    expect(toggleKeyTarget(keys, "b", "ArrowDown")).toBe("c");
    expect(toggleKeyTarget(keys, "b", "Home")).toBe("a");
    expect(toggleKeyTarget(keys, "b", "End")).toBe("c");
    expect(toggleKeyTarget(keys, "b", "x")).toBeNull();
  });
});

describe("AreaChart", () => {
  const series = [
    { key: "rev", label: "Revenue", values: [1, 4, 2, 8, 6], format: { kind: "inr" as const } },
    { key: "ord", label: "Orders", values: [3, 1, 2, 2, 5], format: { kind: "count" as const } },
  ];
  const out = html(<AreaChart labels={["Mon", "Tue", "Wed", "Thu", "Fri"]} series={series} activeKey="rev" ariaLabel="Sales" />);
  it("is a focusable, named chart group that explains itself and how to read it with the keyboard", () => {
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-roledescription="chart"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain("arrow keys");
    expect(out).toContain("Revenue over 5 points");
  });
  it("hides the drawing from assistive tech and announces the point under the crosshair politely", () => {
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(out).toContain('aria-live="polite"');
  });
  it("draws the active series and its axis labels, and no tooltip until pointed at", () => {
    expect(out).toContain("Mon");
    expect(out).toContain("Fri");
    expect(out).toContain('data-show="false"');
  });
  it("renders the final state on the server (no mid-animation value), so reduced motion and no-JS see the truth", () => {
    expect(out).toContain("₹8");
  });
});

describe("ChartCard", () => {
  const series = [
    { key: "rev", label: "Revenue", values: [1, 4, 2, 8, 6], format: { kind: "inr" as const } },
    { key: "ord", label: "Orders", values: [3, 1, 2, 2, 5], format: { kind: "count" as const }, headline: "sum" as const },
  ];
  const labels = ["a", "b", "c", "d", "e"];
  it("has a toggle only when there is more than one series", () => {
    expect(html(<ChartCard title="Sales" labels={labels} series={series} />)).toContain('role="radiogroup"');
    expect(html(<ChartCard title="Sales" labels={labels} series={series.slice(0, 1)} />)).not.toContain('role="radiogroup"');
  });
  it("headlines the total by default, and the latest or average on request", () => {
    expect(headlineOf({ values: [1, 2, 3] })).toBe(6);
    expect(headlineOf({ values: [1, 2, 3], headline: "last" })).toBe(3);
    expect(headlineOf({ values: [1, 2, 3], headline: "avg" })).toBe(2);
    expect(headlineOf({ values: [] })).toBeNull();
  });
  it("compares the later half with the earlier half unless the server supplied a delta, and shows none without history", () => {
    expect(deltaOf({ values: [1, 1, 3, 3] })).toEqual({ pct: 200, direction: "up" });
    expect(deltaOf({ values: [1, 1, 3, 3], delta: null })).toBeNull();
    expect(deltaOf({ values: [5] })).toBeNull();
  });
  it("is a labelled section", () => {
    expect(html(<ChartCard title="Sales" labels={labels} series={series} />)).toContain('aria-label="Sales"');
  });
});

describe("the wow styles obey the motion budget", () => {
  it("every duration is 300ms or less and nothing loops", () => {
    for (const m of css.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
      const ms = m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
      expect(ms, m[0]).toBeLessThanOrEqual(300);
    }
    expect(css).not.toMatch(/infinite/);
  });
  it("uses one easing curve", () => {
    const curves = new Set(css.match(/cubic-bezier\([^)]*\)/g));
    expect(curves.size).toBe(1);
  });
  it("switches every transition off for reduced motion", () => {
    const block = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
    for (const cls of [".kpiCard", ".chartCard", ".segThumb", ".segBtn", ".tip", ".bellRow"]) expect(block, cls).toContain(cls);
    expect(block).toMatch(/transition: none/);
    expect(block).toMatch(/\.kpiCard:hover \{ transform: none/);
  });
  it("uses theme tokens, not literal colours", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgb\(|\bhsl\(/);
  });
  it("gives the KPI card a 14px radius and a hairline border", () => {
    expect(css).toMatch(/\.kpiCard \{[^}]*border: 1px solid var\(--border\)[^}]*border-radius: 14px/s);
  });
  it("draws the dotted grid", () => {
    expect(css).toMatch(/\.grid line \{[^}]*stroke-dasharray/s);
  });
});
