import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./report-actions", () => ({
  approveDigestAction: vi.fn(), createShareAction: vi.fn(), decideShareAction: vi.fn(), discardDigestAction: vi.fn(),
  revokeShareAction: vi.fn(), saveApprovalSettingsAction: vi.fn(), saveDigestSettingsAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/marketing",
  useSearchParams: () => new URLSearchParams("tab=reports"),
}));
vi.mock("next/link", () => ({ default: ({ href, children, scroll: _scroll, ...rest }: { href: string; children?: unknown; scroll?: boolean }) => <a href={href} {...rest}>{children as never}</a> }));

import type { DirectorReport } from "@/lib/director/report";

import { ReportsView } from "./reports-view";

/** Heading levels in document order. Each heading may step down by at most one level from the heading before it. */
const headingLevels = (html: string) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
const sequential = (levels: number[]) => levels.every((lvl, i) => i === 0 ? lvl === 1 : lvl <= levels[i - 1] + 1);

const metrics = { spend: 1000, leads: 10, kyc: 5, funded: 2, revenue: 5000, costPerFunded: 500, roas: 5 };
const report = {
  generatedAt: "2026-10-05T04:00:00.000Z",
  period: { from: "2026-09-28", to: "2026-10-04" },
  comparePeriod: null,
  currency: "INR",
  hasData: true,
  totals: { current: metrics, previous: null, delta: null },
  channels: [],
  campaigns: [],
  wins: ["Meta led on funded customers"],
  risks: ["Google spend is up"],
  nextActions: [],
  freshness: [],
  notes: [],
  thresholds: {},
} as unknown as DirectorReport;

const baseProps = { period: { key: "week" as const, from: "2026-09-28", to: "2026-10-04" }, shares: [], digests: [], digestSettings: { enabled: false, recipients: [] }, approvalSettings: { adCreativeFourEyes: false, reportFourEyes: false }, printHref: "/report-print?from=2026-09-28&to=2026-10-04" };

/** The page's own h1 ("Marketing", from the workspace header) sits above the reports tab, so it is part of the order being checked. */
const page = (canManage: boolean, r: DirectorReport = report) => renderToStaticMarkup(
  <>
    <h1>Marketing</h1>
    <ReportsView {...baseProps} report={r} canManage={canManage} />
  </>,
);

describe("Marketing reports tab headings", () => {
  it("never skips a heading level (h1 then h2 section titles, not h3)", () => {
    const levels = headingLevels(page(false));
    expect(levels).toContain(2);
    expect(levels).not.toContain(3);
    expect(sequential(levels)).toBe(true);
  });
  it("keeps the order when the period has no data and the admin settings form is shown", () => {
    const levels = headingLevels(page(true, { ...report, hasData: false }));
    expect(levels).toEqual([1, 2]);
    expect(sequential(levels)).toBe(true);
  });
  it("keeps the admin settings heading one level below the page title", () => {
    const levels = headingLevels(page(true));
    expect(sequential(levels)).toBe(true);
    expect(page(true)).toContain("Settings (Admin)");
  });
});
