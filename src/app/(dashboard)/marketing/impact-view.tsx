"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MasterDetail, motion, PhoneSheet, ShowFirstBlock, type MasterItem } from "@/components/workspace";
import { CONFIDENCE_LABEL, formatInr } from "@/lib/attribution/format";
import type { ImpactComparison, ImpactReport, ImpactRow, SpendFreshness } from "@/lib/attribution/impact";
import { deltaLabel, sortImpactRows, type ImpactSortKey } from "@/lib/attribution/impact-view";
import type { CustomerLine } from "@/lib/attribution/impact-db";
import type { Banner } from "@/lib/marketing/view-model";
import { formatCount, formatMoney, formatPercent, formatRatio } from "@/lib/marketing/view-model";
import { cn } from "@/lib/utils";

import { KpiTiles, type Kpi } from "./kpi-tiles";
import { StatusBanners } from "./status-banners";

export type ImpactViewData = {
  report: ImpactReport;
  comparison: ImpactComparison | null;
  freshness: { channel: string; label: string; value: SpendFreshness }[];
  customers: Record<string, CustomerLine[]>;
  /** Every customer in the group (the totals count all of them). */
  customerTotals: Record<string, number>;
  /** How many of them the viewer may open, before the per-group cap. */
  customerVisible: Record<string, number>;
  hiddenCustomers: number;
  slaMinutes: number;
  truncated: boolean;
  compareHref: string;
  comparing: boolean;
  previousLabel: string | null;
};

type Column = { key: ImpactSortKey; label: string; numeric: boolean; phoneHide?: boolean; wide?: boolean };
const COLUMNS: Column[] = [
  { key: "label", label: "Campaign", numeric: false },
  { key: "spend", label: "Spend", numeric: true, phoneHide: true },
  { key: "leads", label: "Leads", numeric: true },
  { key: "cpl", label: "Cost / lead", numeric: true },
  { key: "contactedInSlaRate", label: "In SLA", numeric: true, phoneHide: true },
  { key: "kycRate", label: "KYC rate", numeric: true, phoneHide: true, wide: true },
  { key: "funded", label: "Funded", numeric: true, phoneHide: true },
  { key: "revenue", label: "Revenue", numeric: true, phoneHide: true },
  { key: "roas", label: "ROAS", numeric: true },
];

const KIND_WORD: Record<ImpactRow["kind"], string> = { campaign: "Campaign", source: "Source", unattributed: "Not attributed" };

function DeltaChip({ d, invert = false }: { d: ReturnType<typeof deltaLabel> | null; invert?: boolean }) {
  if (!d || d.direction === "none") return d ? <span className="text-xs text-muted-foreground">{d.text}</span> : null;
  const good = d.direction === "flat" ? null : invert ? d.direction === "down" : d.direction === "up";
  return <span className={cn("text-xs", good === true && "text-success", good === false && "text-destructive", good === null && "text-muted-foreground")}>{d.text}</span>;
}

function CohortChart({ row }: { row: ImpactRow }) {
  const cohorts = row.cohorts;
  if (cohorts.length === 0) return <p className="text-sm text-muted-foreground">No leads in this range.</p>;
  const max = Math.max(1, ...cohorts.map((c) => c.leads));
  const W = 320;
  const H = 120;
  const slot = W / cohorts.length;
  const bar = Math.min(34, slot * 0.6);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Leads and funded customers by the month the lead arrived, for ${row.label}`} className="w-full max-w-md">
        {cohorts.map((c, i) => {
          const x = i * slot + (slot - bar) / 2;
          const h = (c.leads / max) * H;
          const fh = (c.funded / max) * H;
          return (
            <g key={c.month}>
              <rect x={x} y={H - h} width={bar} height={h} rx={2} className={cn("fill-chart-2/60", motion.growY)} style={{ ["--i" as string]: i }} />
              <rect x={x} y={H - fh} width={bar} height={fh} rx={2} className={cn("fill-primary", motion.growY)} style={{ ["--i" as string]: i + 1 }} />
              <text x={x + bar / 2} y={H + 13} textAnchor="middle" className="fill-muted-foreground text-[10px]">{c.month.slice(2).replace("-", "/")}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-chart-2/60" aria-hidden />Leads</span>
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-primary" aria-hidden />Funded so far</span>
      </div>
      <table className="sr-only">
        <caption>Cohort by lead month for {row.label}</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Leads</th><th scope="col">Funded</th><th scope="col">Revenue</th></tr></thead>
        <tbody>{cohorts.map((c) => <tr key={c.month}><th scope="row">{c.month}</th><td>{c.leads}</td><td>{c.funded}</td><td>{formatInr(c.revenue)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function CustomerDetail({ c }: { c: CustomerLine }) {
  const contact = { in_sla: "Contacted within the SLA", late: "Contacted late", pending: "Inside the SLA window", missed: "Not contacted" }[c.contact];
  return (
    <div className="flex flex-col gap-3 p-1 text-sm">
      <div>
        <p className="font-heading text-base font-semibold">{c.name}</p>
        <p className="text-muted-foreground">{c.stage}{c.pseudonymous ? "" : ` · RM ${c.rmName ?? "unassigned"}`} · lead on {c.leadDate}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={c.kycApproved ? "success" : "outline"}>{c.kycApproved ? "KYC approved" : "KYC open"}</Badge>
        <Badge variant={c.funded ? "success" : "outline"}>{c.funded ? "Funded" : "Not funded"}</Badge>
        <Badge variant={c.contact === "missed" ? "destructive" : c.contact === "late" ? "warning" : "outline"}>{contact}</Badge>
        {c.confidence && <Badge variant="outline">{CONFIDENCE_LABEL[c.confidence]}</Badge>}
      </div>
      <p>Net revenue to date <span className="font-semibold tabular-nums">{formatInr(c.revenue)}</span></p>
      {!c.pseudonymous && <Link href={`/clients/${c.clientId}/360?tab=journey`} className="w-fit text-sm underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Open the journey</Link>}
    </div>
  );
}

function Detail({ row, data }: { row: ImpactRow; data: ImpactViewData }) {
  const cmp = data.comparison?.rows[row.key];
  const customers = data.customers[row.key] ?? [];
  const total = data.customerTotals[row.key] ?? 0;
  const visible = data.customerVisible[row.key] ?? 0;
  const items: MasterItem[] = customers.map((c) => ({ id: c.clientId, title: c.name, meta: c.pseudonymous ? c.stage : `${c.stage} · ${c.rmName ?? "unassigned"}`, trailing: <span className="tabular-nums">{formatInr(c.revenue)}</span> }));
  const details = Object.fromEntries(customers.map((c) => [c.clientId, <CustomerDetail key={c.clientId} c={c} />]));
  const cur = data.report.currency;
  return (
    <Card role="region" aria-labelledby="impact-detail">
      <CardHeader>
        <CardTitle id="impact-detail" className="flex flex-wrap items-center gap-2 font-heading text-base">
          {row.label}
          <Badge variant="outline">{KIND_WORD[row.kind]}</Badge>
        </CardTitle>
        <CardDescription>
          {row.spend === null ? "No spend is attached to this group, so cost and return are not shown." : `${formatMoney(row.spend, cur)} spent in the range.`}{" "}
          {row.recoveredPct !== null && row.spend ? (row.paybackMonths !== null ? `Revenue has covered the spend ${row.paybackMonths === 0 ? "within the first month" : `after ${row.paybackMonths} month${row.paybackMonths === 1 ? "" : "s"}`}.` : `${Math.round(row.recoveredPct * 100)}% of the spend recovered so far.`) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
          {([["KYC rate", formatPercent(row.kycRate)], ["Funded", `${formatCount(row.funded)} (${formatPercent(row.fundedRate)})`], ["Contacted in SLA", formatPercent(row.contactedInSlaRate)], ["Net revenue", formatInr(row.revenue)], ["Payback", row.spend === null || row.spend <= 0 ? "–" : row.paybackMonths !== null ? (row.paybackMonths === 0 ? "In month 1" : `${row.paybackMonths} mo`) : `${Math.round((row.recoveredPct ?? 0) * 100)}% back`]] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-heading text-sm font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {cmp && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 max-lg:hidden" aria-label="Change against the previous period">
            <span className="text-xs text-muted-foreground">Leads <DeltaChip d={deltaLabel(cmp.leads)} /></span>
            <span className="text-xs text-muted-foreground">Cost per lead <DeltaChip d={deltaLabel(cmp.cpl)} invert /></span>
            <span className="text-xs text-muted-foreground">Funded <DeltaChip d={deltaLabel(cmp.funded)} /></span>
            <span className="text-xs text-muted-foreground">ROAS <DeltaChip d={deltaLabel(cmp.roas)} /></span>
          </div>
        )}
        <div className="grid gap-5 max-lg:hidden lg:grid-cols-2">
          <section aria-labelledby="impact-cohort" className="max-lg:hidden">
            <h2 id="impact-cohort" className="mb-2 text-sm font-semibold">Cohort by lead month</h2>
            <CohortChart row={row} />
          </section>
          <section aria-labelledby="impact-creatives" className="max-lg:hidden">
            <h2 id="impact-creatives" className="mb-2 text-sm font-semibold">Creatives</h2>
            {row.creatives.length === 0 ? (
              <p className="text-sm text-muted-foreground">No creative information came with these leads.</p>
            ) : (
              <ShowFirstBlock
                name="impact-creatives"
                title="Creatives"
                noun="creatives"
                total={row.creatives.length}
                preview={<CreativeTable row={row} rows={row.creatives.slice(0, 3)} />}
                full={<CreativeTable row={row} rows={row.creatives} />}
              />
            )}
            <p className="mt-2 text-xs text-muted-foreground max-lg:hidden">Leads, funded and revenue are counted from the CRM for each creative. Spend per ad is shown only where the platform reports it (Google); for Meta it is not synced, so cost per lead per creative is not shown.</p>
          </section>
        </div>
        <div className="lg:hidden">
          <PhoneSheet name="impact-more" title="Cohorts and creatives" summary={`${row.cohorts.length} lead month${row.cohorts.length === 1 ? "" : "s"}, ${row.creatives.length} creative${row.creatives.length === 1 ? "" : "s"}`}>
            <div className="grid gap-5">
              <section aria-labelledby="impact-cohort-p"><h2 id="impact-cohort-p" className="mb-2 text-sm font-semibold">Cohort by lead month</h2><CohortChart row={row} /></section>
              <section aria-labelledby="impact-creatives-p"><h2 id="impact-creatives-p" className="mb-2 text-sm font-semibold">Creatives</h2>{row.creatives.length === 0 ? <p className="text-sm text-muted-foreground">No creative information came with these leads.</p> : <CreativeTable row={row} rows={row.creatives} />}</section>
            </div>
          </PhoneSheet>
        </div>
        <section aria-labelledby="impact-customers">
          <h2 id="impact-customers" className="mb-2 text-sm font-semibold">Customers from this campaign</h2>
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              {total === 0 ? "No customers in this group." : `${total} customer${total === 1 ? "" : "s"} here belong to relationship managers outside your view.`}
            </p>
          ) : (
            <div className="lg:h-80 lg:[&>div]:h-full">
              <MasterDetail idPrefix="impact-customers" label="Customers from this campaign" items={items} details={details} noun="customers" limit={3} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {visible < total ? `You can open ${formatCount(visible)} of the ${formatCount(total)} customers here; the figures above include all of them. ` : ""}
            {customers.length < visible ? `Showing the ${customers.length} with the most revenue.` : ""}
          </p>
        </section>
      </CardContent>
    </Card>
  );
}

function CreativeTable({ row, rows }: { row: ImpactRow; rows: ImpactRow["creatives"] }) {
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Creatives of {row.label}</caption>
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th scope="col" className="py-1.5 pr-2 font-medium">Creative</th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">Leads</th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">Funded</th>
          <th scope="col" className="py-1.5 pl-2 text-right font-medium">Spend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.name} className="border-b last:border-0">
            <th scope="row" className="max-w-40 truncate py-1.5 pr-2 text-left font-normal" title={c.name}>{c.name}</th>
            <td className="px-2 py-1.5 text-right tabular-nums">{c.leads}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{c.funded}</td>
            <td className="py-1.5 pl-2 text-right tabular-nums">{c.spend === null ? "–" : formatMoney(c.spend, "INR")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ImpactView({ data }: { data: ImpactViewData }) {
  const { report } = data;
  const search = useSearchParams();
  const [sort, setSort] = useState<{ key: ImpactSortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const rows = useMemo(() => sortImpactRows(report.rows, sort.key, sort.dir), [report.rows, sort]);
  const wanted = search?.get("campaign");
  const [picked, setPicked] = useState<string | null>(null);
  const selectedKey = [picked, wanted].find((k) => k && report.rows.some((r) => r.key === k)) ?? report.rows[0]?.key ?? null;
  const selected = report.rows.find((r) => r.key === selectedKey) ?? null;

  const choose = useCallback((key: string) => {
    setPicked(key);
    const q = new URLSearchParams(window.location.search);
    q.set("campaign", key);
    q.delete("item");
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  }, []);

  function toggle(key: ImpactSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "label" ? "asc" : "desc" }));
  }

  const c = data.comparison;
  const t = report.totals;
  const hint = (label: string, d: ReturnType<typeof deltaLabel> | null) => (d ? d.text : label);
  const kpis: Kpi[] = [
    { key: "spend", label: "Spend", value: t.spend, kind: "money", hint: hint("Synced campaigns", c ? deltaLabel(c.totals.spend) : null) },
    { key: "leads", label: "Leads", value: t.leads, kind: "count", hint: hint("By first touch", c ? deltaLabel(c.totals.leads) : null) },
    { key: "cpl", label: "Cost per lead", value: t.cpl, kind: "money", hint: hint("Spend ÷ leads", c ? deltaLabel(c.totals.cpl) : null) },
    { key: "funded", label: "Funded customers", value: t.funded, kind: "count", hint: hint(`${formatPercent(t.contactedInSlaRate)} in SLA`, c ? deltaLabel(c.totals.funded) : null) },
    { key: "revenue", label: "Net revenue", value: t.revenue, kind: "money", hint: hint("Net, to date", c ? deltaLabel(c.totals.revenue) : null) },
    { key: "roas", label: "ROAS", value: t.roas, kind: "ratio", hint: hint("Revenue ÷ spend", c ? deltaLabel(c.totals.roas) : null), tone: t.roas !== null && t.roas >= 1 ? "success" : undefined },
  ];

  const banners: Banner[] = [
    ...data.freshness.filter((f) => f.value.messages.length > 0).map((f) => ({ tone: "warning" as const, text: `${f.label}: ${f.value.messages.join(" ")}` })),
    ...report.notes.map((text) => ({ tone: "neutral" as const, text })),
    ...(data.truncated ? [{ tone: "warning" as const, text: "Showing the most recent 5,000 leads in the range; older leads were left out. Pick a shorter range for exact numbers." }] : []),
  ];

  const table = (list: ImpactRow[]) => (
    <div role="region" aria-label="Campaign impact table, scrollable" tabIndex={0} className="relative overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <table className="w-full text-left text-sm lg:min-w-[44rem]">
        <caption className="sr-only">Campaigns and sources with spend, leads, cost per lead, contacted in SLA, KYC rate, funded customers, revenue and return</caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th key={col.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-2 py-2 font-medium first:pl-5", col.numeric && "text-right", col.phoneHide && "max-lg:hidden", col.wide && "hidden 2xl:table-cell")}>
                  <button type="button" onClick={() => toggle(col.key)} className={cn("inline-flex min-h-8 items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", active && "text-foreground")}>
                    {col.label}
                    <Icon className="size-3" aria-hidden />
                  </button>
                </th>
              );
            })}
            <th scope="col" className="hidden px-2 py-2 pr-5 text-right font-medium 2xl:table-cell">Payback</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={r.key} aria-selected={r.key === selectedKey} className={cn("border-b last:border-0 hover:bg-muted/40", r.key === selectedKey && "bg-primary/5", motion.enter)} style={{ ["--i" as string]: i }}>
              <th scope="row" className="max-w-32 px-2 py-2.5 pl-5 lg:max-w-56 text-left font-medium">
                <button type="button" onClick={() => choose(r.key)} aria-pressed={r.key === selectedKey} className="block min-h-8 w-full rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="block truncate" title={r.label}>{r.label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{KIND_WORD[r.kind]}{r.confidence.low > 0 ? ` · ${r.confidence.low} low confidence` : ""}</span>
                </button>
              </th>
              <td className="px-2 py-2.5 text-right tabular-nums max-lg:hidden">{r.spend === null ? "–" : formatMoney(r.spend, report.currency)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{formatCount(r.leads)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{formatMoney(r.cpl, report.currency)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums max-lg:hidden">{formatPercent(r.contactedInSlaRate)}</td>
              <td className="hidden px-2 py-2.5 text-right tabular-nums 2xl:table-cell">{formatPercent(r.kycRate)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums max-lg:hidden">{formatCount(r.funded)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums max-lg:hidden">{formatInr(r.revenue)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{formatRatio(r.roas)}</td>
              <td className="hidden px-2 py-2.5 pr-5 text-right tabular-nums 2xl:table-cell">{r.spend === null || r.spend <= 0 ? "–" : r.paybackMonths !== null ? (r.paybackMonths === 0 ? "In month 1" : `${r.paybackMonths} mo`) : `${Math.round((r.recoveredPct ?? 0) * 100)}% back`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex shrink-0 flex-col gap-3">
      <KpiTiles kpis={kpis} currency={report.currency} />
      {banners.length > 0 && (
        <PhoneSheet name="impact-notes" title="Notes on the data" summary={`${banners.length} note${banners.length === 1 ? "" : "s"}: spend freshness and coverage`}>
          <StatusBanners banners={banners} />
        </PhoneSheet>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground max-lg:hidden">
          Counted from each customer&apos;s <strong className="font-semibold text-foreground">first touch</strong>.{" "}
          {report.unattributedShare !== null ? `${formatPercent(report.unattributedShare)} of leads could not be attributed.` : ""}
        </p>
        <Link href={data.compareHref} scroll={false} aria-current={data.comparing ? "true" : undefined} className="inline-flex min-h-8 items-center rounded-md border border-border px-2.5 text-[0.8rem] font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {data.comparing ? <>Comparing<span className="max-lg:hidden">&nbsp;with {data.previousLabel}</span></> : <>Compare<span className="max-lg:hidden">&nbsp;with the previous period</span></>}
        </Link>
      </div>
      <Card>
        <CardHeader className="max-lg:hidden">
          <CardTitle className="font-heading">Campaign impact</CardTitle>
          <CardDescription className="max-lg:hidden">Select a heading to sort and a campaign to see its cohorts, creatives and customers. A dash means the figure cannot be known, not that it is zero. Revenue is net brokerage and advisory revenue to date, so recent months look lower than they will.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <ShowFirstBlock name="impact-table" title="All campaigns and sources" noun="rows" total={rows.length} preview={table(rows.slice(0, 3))} full={table(rows)} />
        </CardContent>
      </Card>
      {selected && <Detail row={selected} data={data} />}
    </div>
  );
}
