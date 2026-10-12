import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { DirectorReport } from "@/lib/director/report";

import { ReportDocument } from "./report-document";

/** Heading levels in document order. Every heading must step down by no more than one level from the one before it (WCAG 1.3.1). */
const headingLevels = (html: string) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
const sequential = (levels: number[]) => levels.every((lvl, i) => i === 0 ? lvl === 1 : lvl <= levels[i - 1] + 1);

const metrics = { spend: 1000, leads: 10, kyc: 5, funded: 2, revenue: 5000, costPerFunded: 500, roas: 5 };
const base = {
  generatedAt: "2026-10-05T04:00:00.000Z",
  period: { from: "2026-09-28", to: "2026-10-04" },
  comparePeriod: null,
  currency: "INR",
  hasData: true,
  totals: { current: metrics, previous: null, delta: null },
  channels: [{ channel: "meta", label: "Meta", available: true, current: metrics, previous: null, delta: null }],
  campaigns: [{ channel: "meta", campaignId: "c1", name: "Launch", spend: 1000, leads: 10, funded: 2, revenue: 5000 }],
  wins: ["Meta led on funded customers"],
  risks: ["Google spend is up"],
  nextActions: ["Review the Meta creative"],
  freshness: [{ channel: "meta", label: "Meta", asOf: null, ageHours: null, stale: false }],
  notes: [],
  thresholds: {},
} as unknown as DirectorReport;

describe("ReportDocument headings and landmarks", () => {
  it("has one h1 and every section title is an h2, with no skipped levels", () => {
    const levels = headingLevels(renderToStaticMarkup(<ReportDocument report={base} />));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels.every((l) => l === 1 || l === 2)).toBe(true);
    expect(sequential(levels)).toBe(true);
  });
  it("keeps the same heading order when there is not enough data", () => {
    const levels = headingLevels(renderToStaticMarkup(<ReportDocument report={{ ...base, hasData: false }} />));
    expect(levels).toEqual([1]);
    expect(sequential(levels)).toBe(true);
  });
  it("is the single main landmark, named by the report title", () => {
    const html = renderToStaticMarkup(<ReportDocument report={base} />);
    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="report-title"');
    expect(html).toContain('id="report-title"');
  });
});
