import { shareState } from "@/lib/director/share";
import { getDigestSettings } from "@/lib/creative/settings";
import { listDigests, listShares, loadDirectorReport } from "@/lib/director/db";
import { previousWeeks } from "@/lib/director/digest";
import { addDays } from "@/lib/marketing/dates";
import { formatMoney } from "@/lib/marketing/view-model";

import { Rail, type RailFact } from "./rail";
import { ReportsView } from "./reports-view";
import { TabLayout } from "./tab-layout";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const REAL = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? v : null);

/** Director reports: a period report blending the channels with funded customers and revenue, shareable links, the printable page and the weekly digest drafts. */
export async function ReportsTab({ params, today, isAdmin, now }: { params: Params; today: string; isAdmin: boolean; now: Date }) {
  let key: "week" | "30d" | "custom" = one(params.rp) === "30d" ? "30d" : one(params.rp) === "custom" ? "custom" : "week";
  let from: string;
  let to: string;
  if (key === "custom") {
    const f = REAL(one(params.rfrom));
    const t = REAL(one(params.rto));
    const days = f && t ? (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000 + 1 : 0;
    if (f && t && f <= t && t <= today && days <= 90) [from, to] = [f, t];
    else { key = "week"; ({ from, to } = previousWeeks(now).current); }
  } else if (key === "30d") {
    to = today;
    from = addDays(today, -29);
  } else ({ from, to } = previousWeeks(now).current);

  const [report, shares, digests, digestSettings] = await Promise.all([loadDirectorReport(from, to, now), listShares(now), listDigests(), getDigestSettings()]);
  const t = report.totals.current;
  const facts: RailFact[] = [
    { key: "funded", label: "Funded customers", value: t.funded === null ? "Not available" : { n: t.funded, kind: "count" } },
    { key: "revenue", label: "Revenue booked", value: t.revenue === null ? "Not available" : formatMoney(t.revenue, report.currency) },
    { key: "links", label: "Open share links", value: { n: shares.filter((s) => shareState(s, now) === "open").length, kind: "count" } },
    { key: "digest", label: "Digest drafts waiting", value: { n: digests.filter((d) => d.status === "DRAFT").length, kind: "count" }, tone: digests.some((d) => d.status === "DRAFT") ? "warning" : undefined },
  ];

  return (
    <TabLayout
      tab="reports"
      rail={<Rail facts={facts} />}
      main={
        <ReportsView
          report={report}
          period={{ key, from, to }}
          shares={shares.map((s) => ({ id: s.id, label: s.label, periodFrom: s.periodFrom.toISOString().slice(0, 10), periodTo: s.periodTo.toISOString().slice(0, 10), expiresAt: s.expiresAt.toISOString(), viewCount: s.viewCount, state: s.state }))}
          digests={digests.map((d) => ({ id: d.id, weekStart: d.weekStart.toISOString().slice(0, 10), subject: d.subject, bodyText: d.bodyText, recipients: d.recipients, status: d.status }))}
          digestSettings={digestSettings}
          isAdmin={isAdmin}
          printHref={`/report-print?from=${from}&to=${to}`}
        />
      }
    />
  );
}
