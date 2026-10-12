import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Lightbulb, MessageSquareReply, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { agentLabel, blockReasonLabel, fmtDuration, fmtPct, fmtPctSample, fmtRatio, NOT_ENOUGH_DATA, trendLabel } from "@/lib/insights/format";
import type { InsightsData } from "@/lib/insights/compose";
import { PRICE_TABLE_AS_OF, formatUsd } from "@/lib/insights/pricing";
import { compareVariants } from "@/lib/insights/variant";
import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";
import { KpiStrip, KpiTile, PhoneSheet, ShowFirst, ShowFirstBlock, motion } from "@/components/workspace";

/** Stagger index for the shared motion classes (40ms a step, capped by the class). */
const delay = (ms: number): CSSProperties => ({ ["--i" as string]: Math.round(ms / 50) });

/**
 * A titled card. With `fold`, a phone shows one dense row (the title and this one-line summary) that opens the card in a sheet;
 * a laptop shows the card in place.
 */
export function Section({ title, description, children, at = 0, fold }: { title: string; description?: string; children: ReactNode; at?: number; fold?: string }) {
  const card = (
    <Card className={motion.enter} style={delay(at)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className={fold ? undefined : "max-lg:hidden"}>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
  return fold ? (
    <PhoneSheet name={`sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 36)}`} title={title} summary={fold}>
      {card}
    </PhoneSheet>
  ) : (
    card
  );
}

// ---- KPI tiles -------------------------------------------------------------------------------------------------

type Tile = { label: string; value: ReactNode; sub: string; note?: string };

export function KpiTiles({ kpis }: { kpis: InsightsData["kpis"] }) {
  const tiles: Tile[] = [
    { label: "Outcomes logged", value: <CountUp value={kpis.outcomes} />, sub: "RM and agent outcomes in this period" },
    {
      label: "Interested or converted",
      value: kpis.positiveRate === null ? "—" : <CountUp value={kpis.positiveRate * 100} suffix="%" />,
      sub: kpis.positiveRate === null ? "No outcomes yet" : "Share of all outcomes",
    },
    {
      label: "Reply rate",
      value: kpis.replyRate === null ? "—" : <CountUp value={kpis.replyRate * 100} suffix="%" />,
      sub: kpis.replyRate === null ? "No WhatsApp messages old enough" : "Customers who answered within 72 hours",
    },
    {
      label: "Median time to reply",
      value: kpis.medianReplyHours === null ? "—" : <CountUp value={kpis.medianReplyHours} decimals={1} suffix=" h" />,
      sub: kpis.medianReplyHours === null ? "No replies yet" : "First reply after a message",
    },
    {
      label: "Agent drafts",
      value: <CountUp value={kpis.draftsGenerated} />,
      sub: kpis.approvalRate === null ? "No drafts reviewed yet" : `${fmtPct(kpis.approvalRate)} approved by a person`,
    },
    {
      label: "Est. cost per approved message",
      value: kpis.costPerApprovedUsd === null ? "n/a" : <CountUp value={kpis.costPerApprovedUsd} decimals={3} prefix="$" />,
      sub: "Drafting calls only, from an assumed price table",
      note: !kpis.costAvailable ? "Needs approved messages and a known model" : kpis.costPartial ? "Partial: a lower bound (some rows or models are missing)" : undefined,
    },
  ];
  return (
    <KpiStrip>
      {tiles.map((t, i) => (
        <KpiTile key={t.label} label={t.label} index={i} hint={<span title={[t.sub, t.note].filter(Boolean).join(". ")}>{t.note ?? t.sub}</span>} tone={t.note ? "warning" : "default"}>
          {t.value}
        </KpiTile>
      ))}
    </KpiStrip>
  );
}

// ---- Suggestions -----------------------------------------------------------------------------------------------

export function SuggestionsPanel({ suggestions }: { suggestions: InsightsData["suggestions"] }) {
  const attention = suggestions.filter((s) => s.severity === "attention").length;
  return (
    <Section title="Suggested improvements" description="Plain-language findings from the numbers on this page. Rule-based, no AI model involved, and they never change anything on their own." at={100} fold={suggestions.length === 0 ? "Nothing to suggest right now" : `${suggestions.length} finding${suggestions.length === 1 ? "" : "s"}${attention ? `, ${attention} need attention` : ""}`}>
      <ul className="flex flex-col gap-3">
        {suggestions.map((s, i) => (
          <li key={s.id} className={`${motion.enter} flex gap-3 rounded-lg border border-border p-3`} style={delay(150 + i * 70)}>
            <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", s.severity === "attention" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary")}>
              {s.severity === "attention" ? <AlertTriangle className="size-4" aria-hidden="true" /> : <Lightbulb className="size-4" aria-hidden="true" />}
              <span className="sr-only">{s.severity === "attention" ? "Needs attention" : "For information"}</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm">{s.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">Evidence: {s.evidence}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---- Response tables -------------------------------------------------------------------------------------------

function RateTable({ caption, firstHeading, rows }: { caption: string; firstHeading: string; rows: InsightsData["response"]["byGroup"] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No messages old enough to measure yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">{firstHeading}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Messages</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Replied</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Median reply</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-medium">{r.key}</th>
              <td className="px-3 py-2 text-right tabular-nums">{r.sent}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.replyRate)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(r.medianHours === null ? null : r.medianHours * 60)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResponseTables({ response }: { response: InsightsData["response"] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <RateTable caption="Reply rate by sender" firstHeading="Sent by" rows={response.byGroup} />
      <RateTable caption="Reply rate by language" firstHeading="Language" rows={response.byLanguage} />
      {response.immature > 0 && <p className="text-xs text-muted-foreground md:col-span-2">{response.immature} recent messages are left out until they have had 72 hours to be answered.</p>}
    </div>
  );
}

export function ConversionTable({ conversion }: { conversion: InsightsData["conversion"] }) {
  const rows = [...(conversion.afterDraft ? [conversion.afterDraft] : []), ...conversion.byOutcome];
  if (rows.length === 0) return <EmptyState icon={MessageSquareReply} title="Nothing mature enough yet" description={`Outcomes and drafts count here once they are ${conversion.days} days old. This table looks at events from before the selected range as well.`} />;
  const table = (list: typeof rows) => (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Share of customers reaching KYC approval or funding within {conversion.days} days</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">After</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Customers</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">KYC approved</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Funded</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key} className="border-b border-border/60 last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">{r.key}</th>
                <td className="px-3 py-2 text-right tabular-nums">{r.n}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPctSample(r.kycRate, r.n, 20)} <span className="text-xs text-muted-foreground">({fmtRatio(r.kyc, r.n)})</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPctSample(r.fundedRate, r.n, 20)} <span className="text-xs text-muted-foreground">({fmtRatio(r.funded, r.n)})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <ShowFirstBlock name="conversion" title="Conversion after each outcome" noun="rows" total={rows.length} preview={table(rows.slice(0, 5))} full={table(rows)} />
      <p className="text-xs text-muted-foreground max-lg:hidden">Within {conversion.days} days of the outcome or draft. Correlation, not proof that the message caused it.{conversion.immature > 0 ? ` ${conversion.immature} newer items are left out until they are ${conversion.days} days old.` : ""}</p>
    </div>
  );
}

// ---- Objection heat table --------------------------------------------------------------------------------------

const TREND_ICON = { up: ArrowUp, down: ArrowDown } as const;

export function ObjectionHeat({ objections }: { objections: InsightsData["objections"] }) {
  const { rows, themes } = objections;
  if (rows.length === 0) return <EmptyState icon={Sparkles} title="No concerns recorded in this period" description="Concerns customers raise in conversations are grouped into themes here." />;
  const shown = themes.slice(0, 8);
  const counts = (r: (typeof rows)[number], theme: string) => r.themes.find((t) => t.theme === theme)?.count ?? 0;
  const max = Math.max(1, ...rows.flatMap((r) => shown.map((t) => counts(r, t))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
        <caption className="sr-only">Customer concerns by asset class and theme, with the biggest theme and its trend against the previous period</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-1 font-medium">Asset class</th>
            {shown.map((t) => (
              <th key={t} scope="col" className="px-1 py-1 text-center font-medium leading-tight">{t}</th>
            ))}
            <th scope="col" className="px-2 py-1 font-medium">Biggest, vs last period</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const top = r.themes[0];
            const Icon = top && top.trend in TREND_ICON ? TREND_ICON[top.trend as keyof typeof TREND_ICON] : null;
            return (
              <tr key={r.assetClass}>
                <th scope="row" className="px-2 py-1 text-left font-medium">{r.assetClass}<span className="block text-xs font-normal text-muted-foreground">{r.total} concerns</span></th>
                {shown.map((t, ti) => {
                  const c = counts(r, t);
                  return (
                    <td
                      key={t}
                      className={`${motion.enter} rounded-md text-center tabular-nums`}
                      style={{ ...delay(200 + (ri * shown.length + ti) * 18), backgroundColor: c ? `color-mix(in oklab, var(--chart-3) ${Math.round(10 + (c / max) * 65)}%, transparent)` : "var(--muted)" }}
                    >
                      <span className="block py-2" aria-label={`${c} concerns`}>{c || "·"}</span>
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-xs">
                  {top && (
                    <span className="flex items-center gap-1">
                      <span className="font-medium">{top.theme}</span>
                      {Icon && <Icon className={cn("size-3.5", top.trend === "up" ? "text-destructive" : "text-success")} aria-hidden="true" />}
                      <span className="text-muted-foreground">{trendLabel(top.trend, top.count, top.prevCount)}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Journey funnel --------------------------------------------------------------------------------------------

export function JourneyFunnel({ funnel }: { funnel: InsightsData["funnel"] }) {
  const max = Math.max(0, ...funnel.map((f) => f.reached));
  if (funnel.length === 0 || max === 0) return <EmptyState icon={Sparkles} title="No customers joined in this period" description="Stage conversion and time in stage appear as customers move through the journey." />;
  return (
    <ol className="flex flex-col gap-3" aria-label="Journey stages">
      {funnel.map((f, i) => (
        <li key={f.stageId} className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(7rem,10rem)_1fr_minmax(9rem,12rem)]">
          <div>
            <p className="text-sm font-medium">{f.name}</p>
            <p className="text-xs text-muted-foreground">{f.reached} reached</p>
          </div>
          <div className="h-6 rounded-md bg-muted" role="img" aria-label={`${f.name}: ${f.reached} of ${max} customers reached this stage`}>
            <div className={`${motion.growX} h-full rounded-md bg-primary`} style={{ width: `${(f.reached / max) * 100}%`, ...delay(150 + i * 90) }} />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
            {f.conversion === null ? (i === funnel.length - 1 ? "Final stage" : "No data") : <><span className="font-medium text-foreground">{fmtPctSample(f.conversion, f.reached, 20)}</span>{f.conversion === 0 && f.reached < 20 ? "" : " moved on"}</>}
            {" · "}
            {f.medianHoursInStage === null ? "no completed stays" : `median ${fmtDuration(f.medianHoursInStage * 60)} here`}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ---- Agent quality ---------------------------------------------------------------------------------------------

function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={value === NOT_ENOUGH_DATA ? "mt-1 text-sm font-medium text-muted-foreground" : "mt-0.5 font-heading text-lg font-bold tabular-nums"}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Stack({ segments, label }: { segments: { key: string; label: string; count: number; colour: string }[]; label: string }) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${segments.filter((s) => s.count).map((s) => `${s.label} ${s.count}`).join(", ")}`}>
        {segments.map((s, i) => (
          <div key={s.key} className={`${motion.growX} h-full`} style={{ width: `${(s.count / total) * 100}%`, background: s.colour, ...delay(150 + i * 80) }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.colour }} aria-hidden="true" />
            {s.label} <span className="tabular-nums text-foreground">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentQualityPanel({ agents }: { agents: InsightsData["agents"] }) {
  if (agents.length === 0) return <EmptyState icon={Sparkles} title="No agent drafts in this period" description="Quality and safety figures appear once an agent has drafted messages." />;
  return (
    <div className="flex flex-col gap-6">
      {agents.map((a) => (
        <section key={a.agentKey} aria-label={agentLabel(a.agentKey)} className="flex flex-col gap-4">
          <h3 className="font-heading text-base font-bold">{agentLabel(a.agentKey)}</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Metric label="Drafts generated" value={a.generated} />
            <Metric label="Blocked by guardrails" value={fmtPctSample(a.blocked.rate, a.generated, 5)} sub={`${a.blocked.regex} by pattern rules, ${a.blocked.judge} by the judge`} />
            <Metric label="Approval rate" value={fmtPctSample(a.approvalRate, a.offered, 5)} sub={`${fmtRatio(a.approved, a.offered)} reviewed drafts`} />
            <Metric label="Edit rate" value={fmtPctSample(a.editRate, a.approved, 5)} sub={`${fmtRatio(a.edited, a.approved)} approved drafts changed`} />
            <Metric label="Rejection rate" value={fmtPctSample(a.rejectionRate, a.offered, 5)} sub={fmtRatio(a.rejected, a.offered)} />
            <Metric label="Expiry rate" value={fmtPctSample(a.expiryRate, a.offered, 5)} sub={`${fmtRatio(a.expired, a.offered)}${a.pending ? `, ${a.pending} still waiting` : ""}`} />
            <Metric label="Median time to approve" value={fmtDuration(a.medianApproveMinutes)} />
            <Metric label="Messages sent" value={a.sent} />
            <Metric label="Tokens used" value={`${a.tokens.input.toLocaleString("en-IN")} in`} sub={`${a.tokens.output.toLocaleString("en-IN")} out`} />
            <Metric
              label="Est. cost per approved message"
              value={a.cost.perApprovedUsd === null ? "n/a" : formatUsd(a.cost.perApprovedUsd)}
              sub={a.cost.unknownModels.length ? `Model not in price table: ${a.cost.unknownModels.join(", ")}${a.cost.partial ? " (partial)" : ""}` : "Estimate for drafting calls only, includes blocked and rejected drafts"}
            />
          </div>

          <Stack
            label="What happened to each draft"
            segments={[
              { key: "approved", label: "Approved", count: a.approved, colour: "var(--chart-1)" },
              { key: "pending", label: "Waiting", count: a.pending, colour: "var(--chart-2)" },
              { key: "rejected", label: "Rejected", count: a.rejected, colour: "var(--destructive)" },
              { key: "expired", label: "Expired", count: a.expired, colour: "var(--muted-foreground)" },
              { key: "blocked", label: "Blocked", count: a.blocked.total, colour: "var(--chart-3)" },
              { key: "recheck", label: "Blocked after edit", count: a.blockedAfterEdit, colour: "var(--chart-5)" },
            ]}
          />
          <Stack
            label="How much people edit approved drafts"
            segments={[
              { key: "none", label: "Unchanged", count: a.editBuckets.none, colour: "var(--chart-1)" },
              { key: "light", label: "Light edit (under 10%)", count: a.editBuckets.light, colour: "var(--chart-4)" },
              { key: "moderate", label: "Moderate (10 to 30%)", count: a.editBuckets.moderate, colour: "var(--chart-5)" },
              { key: "heavy", label: "Heavy (over 30%)", count: a.editBuckets.heavy, colour: "var(--chart-3)" },
            ]}
          />
          {Object.keys(a.blocked.byReason).length > 0 && (
            <p className="text-xs text-muted-foreground">
              Block reasons:{" "}
              {Object.entries(a.blocked.byReason)
                .sort((x, y) => y[1] - x[1])
                .map(([code, n]) => `${blockReasonLabel(code)} ${n}`)
                .join(", ")}
              . The judge&apos;s own wording is not stored here.
            </p>
          )}
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Costs are estimates from a fixed price table ({PRICE_TABLE_AS_OF}); they are not billing data and cover the drafting calls only (the guardrail judge call is not recorded, so real spend is higher). A model that is not in the table shows n/a.</p>
    </div>
  );
}

// ---- A/B readiness ---------------------------------------------------------------------------------------------

export function AbPanel({ aiVsRm }: { aiVsRm: InsightsData["aiVsRm"] }) {
  if (!aiVsRm) return <EmptyState icon={MessageSquareReply} title="No messages to compare yet" description="This compares reply rates for AI drafts against RM-only messages once both have been sent." />;
  const cmp = compareVariants(aiVsRm.a, aiVsRm.b);
  const arms = [
    { name: "AI drafts (approved and sent)", ...aiVsRm.a },
    { name: "RM-only messages", ...aiVsRm.b },
  ];
  const status =
    cmp.status === "too_early"
      ? { label: "Too early to call", tone: "bg-warning/15 text-warning", note: cmp.reason }
      : cmp.status === "not_significant"
        ? { label: "No clear difference", tone: "bg-muted text-muted-foreground", note: "The gap is within normal variation." }
        : { label: `${cmp.better === "a" ? "AI drafts" : "RM-only"} ahead`, tone: "bg-primary/15 text-primary", note: `Two-proportion z-test, p = ${cmp.result.pValue.toFixed(3)}.` };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {arms.map((a, i) => (
          <div key={a.name} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{a.name}</p>
            <p className="mt-1 font-heading text-2xl font-extrabold tabular-nums">{fmtPct(a.n ? a.successes / a.n : null)}</p>
            <div className="mt-2 h-2 rounded-full bg-muted" role="img" aria-label={`${a.successes} of ${a.n} replied`}>
              <div className={`${motion.growX} h-full rounded-full bg-primary`} style={{ width: `${a.n ? (a.successes / a.n) * 100 : 0}%`, ...delay(150 + i * 100) }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{fmtRatio(a.successes, a.n)} replied</p>
          </div>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", status.tone)}>{status.label}</span>
        <span className="text-muted-foreground">{status.note}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        This is an observed comparison, not an experiment: customers were not randomly assigned. When a real experiment is set up, customers can be split deterministically with the assignment helper, and results under 30 per group will still read &quot;too early&quot;. The nudger itself is unchanged.
      </p>
    </div>
  );
}

// ---- Drill-down ------------------------------------------------------------------------------------------------

export function Drilldown({ rows }: { rows: InsightsData["drilldown"] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No declines, handovers or service issues in this period.</p>;
  return (
    <ShowFirst
      name="drilldown"
      title="Declines and handovers"
      noun="rows"
      flush
      className="divide-y divide-border"
      sheetClassName="divide-y divide-border"
      items={rows.map((r) => (
        <div key={`${r.clientId}-${r.at}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <Link href={`/clients/${r.clientId}`} className="font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {r.firstName} <span className="font-normal text-muted-foreground">{r.clientCode}</span>
          </Link>
          <span className="text-xs text-muted-foreground">
            {r.outcomeLabel}
            {r.assetClass ? ` · ${r.assetClass}` : ""} · {new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
          </span>
        </div>
      ))}
    />
  );
}
