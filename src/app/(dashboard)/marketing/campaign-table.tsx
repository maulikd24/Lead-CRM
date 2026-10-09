"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignRow, QualityTone } from "@/lib/marketing/metrics";
import { formatCount, formatMoney, formatPercent, formatRatio, sortCampaigns, type SortKey } from "@/lib/marketing/view-model";

import styles from "./marketing.module.css";

const TONE_VARIANT: Record<QualityTone, "success" | "warning" | "destructive" | "outline"> = { success: "success", warning: "warning", destructive: "destructive", neutral: "outline" };
const MAX_SPARK_BARS = 30;

/** Sums a long daily series into at most MAX_SPARK_BARS buckets so a 90-day range still reads as bars. */
function bucket(values: number[]): number[] {
  if (values.length <= MAX_SPARK_BARS) return values;
  const size = Math.ceil(values.length / MAX_SPARK_BARS);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
  return out;
}

function SparkBars({ values, row }: { values: number[]; row: number }) {
  const bars = bucket(values);
  const max = Math.max(1, ...bars);
  return (
    <div aria-hidden className="flex h-7 w-24 items-end gap-px">
      {bars.map((v, i) => (
        <div key={i} className={`${styles.sparkBar} flex-1 rounded-t-[1px] bg-chart-2/70`} style={{ height: `${Math.max(v > 0 ? 8 : 3, (v / max) * 100)}%`, ["--i" as string]: i, ["--row" as string]: row, opacity: v > 0 ? 1 : 0.3 }} />
      ))}
    </div>
  );
}

type Column = { key: SortKey; label: string; numeric: boolean };
const COLUMNS: Column[] = [
  { key: "name", label: "Campaign", numeric: false },
  { key: "spend", label: "Spend", numeric: true },
  { key: "crmLeads", label: "Leads (CRM / Meta)", numeric: true },
  { key: "cpl", label: "Cost per lead", numeric: true },
  { key: "kycRate", label: "KYC rate", numeric: true },
  { key: "funded", label: "Funded", numeric: true },
  { key: "costPerFunded", label: "Cost per funded", numeric: true },
  { key: "aum", label: "Funded AUM", numeric: true },
  { key: "aumPerRupee", label: "AUM per ₹", numeric: true },
];

export function CampaignTable({ campaigns, currency }: { campaigns: CampaignRow[]; currency: string | null }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const rows = useMemo(() => sortCampaigns(campaigns, sort.key, sort.dir), [campaigns, sort]);

  function toggle(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Campaigns</CardTitle>
        <CardDescription>Select a column heading to sort. The bars show daily spend across the range. The quality flag compares each campaign with the account average and says so plainly when there is too little data to judge.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Campaigns with spend, leads, cost per lead, KYC rate, funded customers and quality flag</caption>
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={col.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 font-medium first:pl-5 ${col.numeric ? "text-right" : ""}`}>
                    <button type="button" onClick={() => toggle(col.key)} className={`inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${active ? "text-foreground" : ""}`}>
                      {col.label}
                      <Icon className="size-3" aria-hidden />
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="px-3 py-2 pr-5 font-medium">Daily spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, row) => (
              <tr key={c.campaignId} className="border-b last:border-0 hover:bg-muted/40">
                <th scope="row" className="max-w-72 px-3 py-3 pl-5 text-left font-medium">
                  <span className="block truncate" title={c.name}>{c.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{`ID ${c.campaignId}`}</span>
                  <Badge className="mt-1.5" variant={TONE_VARIANT[c.quality.tone]} title={c.quality.detail}>{c.quality.label}</Badge>
                  <span className="sr-only">{c.quality.detail}</span>
                </th>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(c.spend, currency)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatCount(c.crmLeads)}
                  <span className="text-muted-foreground">{` / ${formatCount(c.metaLeads)}`}</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(c.cpl, currency)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatPercent(c.kycRate)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCount(c.funded)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(c.costPerFunded, currency)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(c.aum, "INR")}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatRatio(c.aumPerRupee)}</td>
                <td className="px-3 py-3 pr-5">
                  <SparkBars values={c.spark} row={row} />
                  <span className="sr-only">{`Spend on ${c.spark.length} days`}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
