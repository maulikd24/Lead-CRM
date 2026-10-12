import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./creative-actions", () => ({
  deleteExperimentAction: vi.fn(), saveExperimentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/marketing",
  useSearchParams: () => new URLSearchParams("tab=experiments"),
}));

import type { ExperimentsData } from "@/lib/creative/experiments-view";

import { ExperimentsView } from "./experiments-view";

/** Heading levels in document order. Each heading may step down by at most one level from the heading before it. */
const headingLevels = (html: string) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
const sequential = (levels: number[]) => levels.every((lvl, i) => i === 0 ? lvl === 1 : lvl <= levels[i - 1] + 1);

const data = {
  experiments: [{
    id: "e1", name: "Shorter form", hypothesis: "A shorter form lifts completion.", metric: "funded_rate", baselineRate: 0.04, mde: 0.1, mdeKind: "relative" as const,
    visitorsPerDay: 500, sampleSizePerArm: 12000, startAt: "2026-10-01", endAt: null, status: "RUNNING" as const, decision: null, learning: null, campaignIds: [],
  }],
  campaigns: [],
  observed: null,
  names: {},
} as unknown as ExperimentsData;

/** The workspace page's own h1 ("Marketing", from the header) sits above the experiments tab, so it is part of the order being checked. */
const page = (d: ExperimentsData = data) => renderToStaticMarkup(
  <>
    <h1>Marketing</h1>
    <ExperimentsView data={d} />
  </>,
);

describe("Marketing experiments tab headings", () => {
  it("never skips a heading level (h1 then h2 section titles, not h3)", () => {
    const levels = headingLevels(page());
    expect(levels).toContain(2);
    expect(levels).not.toContain(3);
    expect(sequential(levels)).toBe(true);
  });
  it("keeps the order when there are no experiments yet", () => {
    const levels = headingLevels(page({ ...data, experiments: [] }));
    expect(sequential(levels)).toBe(true);
    expect(levels).not.toContain(3);
  });
});
