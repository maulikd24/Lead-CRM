import { Badge } from "@/components/ui/badge";
import type { AuctionReport } from "@/lib/autopilot/auction";
import type { PacingRow } from "@/lib/autopilot/pacing";
import type { RegionReport } from "@/lib/autopilot/regions";
import { inr, pct } from "@/lib/autopilot/stats";
import type { TimingReport } from "@/lib/autopilot/timing";
import type { TrackingReport } from "@/lib/autopilot/tracking";
import type { WasteReport } from "@/lib/autopilot/waste";

import { NotAvailable, Panel, ScrollBox } from "./ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WasteTab({ waste }: { waste: WasteReport }) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Estimated wasted spend: <strong className="tabular-nums">{inr(waste.wasted)}</strong>
        {waste.wastedShare !== null ? <> , <strong className="tabular-nums">{pct(waste.wastedShare, 1)}</strong> of the {inr(waste.totalSpend)} spent in this period</> : null}. Each rupee is counted under one cause only.
      </p>
      <ScrollBox label="Wasted spend by cause">
        <table className="w-full text-sm">
          <caption className="sr-only">Wasted spend by cause</caption>
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Cause</th><th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th><th scope="col" className="py-2 pr-3 text-right font-medium">Share of spend</th><th scope="col" className="hidden py-2 font-medium md:table-cell">Biggest items</th></tr></thead>
          <tbody>
            {waste.causes.map((c) => (
              <tr key={c.key} className="border-b align-top">
                <th scope="row" className="py-2 pr-3 text-left font-medium">{c.label}<p className="text-xs font-normal text-muted-foreground">{c.how}</p></th>
                {c.available ? (<><td className="py-2 pr-3 text-right tabular-nums">{inr(c.amount)}</td><td className="py-2 pr-3 text-right tabular-nums">{pct(c.share ?? 0, 1)}</td></>) : <td colSpan={2} className="py-2 pr-3 text-right"><Badge variant="outline">Not available</Badge></td>}
                <td className="hidden py-2 text-xs text-muted-foreground md:table-cell">{c.top.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
    </div>
  );
}

export function TimingTab({ t }: { t: TimingReport }) {
  const cell = new Map(t.heat.cells.map((c) => [`${c.dow}-${c.hour}`, c]));
  const max = Math.max(1, ...t.heat.cells.map((c) => c.conversions));
  return (
    <div className="space-y-4">
      <Panel title="Conversions by day and hour" description="What the ad platform reports, in the account's own time. Darker means more conversions.">
        {t.heat.available ? (
          <ScrollBox label="Conversions by day and hour">
            <table className="border-separate border-spacing-px text-[10px]">
              <caption className="sr-only">Conversions by weekday and hour of day</caption>
              <thead><tr><td />{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col" className="w-6 text-center font-normal text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>
                {DAYS.map((d, i) => (
                  <tr key={d}>
                    <th scope="row" className="pr-1 text-right font-normal text-muted-foreground">{d}</th>
                    {Array.from({ length: 24 }, (_, h) => { const c = cell.get(`${i}-${h}`); const n = c?.conversions ?? 0; return <td key={h} title={`${d} ${h}:00: ${n} conversions, ${inr(c?.spend ?? 0)} spent`} className="h-6 w-6 rounded-[3px] border text-center tabular-nums" style={{ backgroundColor: n > 0 ? `color-mix(in oklab, var(--primary) ${Math.round(15 + (n / max) * 70)}%, transparent)` : undefined }}>{n || ""}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollBox>
        ) : <NotAvailable>The platforms have not reported conversions by hour yet.</NotAvailable>}
      </Panel>
      <Panel title="After the click: by the hour the lead arrived" description="Only we can see this: how quickly leads were called and how many became funded customers, by the time they arrived.">
        {t.leadsUsed === 0 ? <NotAvailable>No leads in this period.</NotAvailable> : (
          <ScrollBox label="Lead arrival bands">
            <table className="w-full text-sm">
              <caption className="sr-only">Lead arrival time band: leads, first-contact speed and funded rate</caption>
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Arrived</th><th scope="col" className="py-2 pr-3 text-right font-medium">Leads</th><th scope="col" className="py-2 pr-3 text-right font-medium">Median first contact</th><th scope="col" className="py-2 pr-3 text-right font-medium">Not yet contacted</th><th scope="col" className="py-2 text-right font-medium">Funded</th></tr></thead>
              <tbody>
                {t.bands.map((b) => (
                  <tr key={b.key} className="border-b">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">{b.label}</th>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.leads}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.medianContactMinutes === null ? "n/a" : `${Math.round(b.medianContactMinutes)} min`}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.uncontactedShare === null ? "n/a" : pct(b.uncontactedShare)}</td>
                    <td className="py-2 text-right tabular-nums">{b.fundedRate === null ? "n/a" : `${pct(b.fundedRate, 1)} (${b.funded})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollBox>
        )}
        <ul className="mt-3 space-y-2 text-sm">
          {t.recommendations.map((r) => <li key={r.kind + r.band} className="rounded-md border p-2"><strong>{r.headline}.</strong><span className="block text-xs text-muted-foreground">{r.evidence.join(" · ")}</span></li>)}
          {t.holds.map((h) => <li key={h.band} className="text-xs text-muted-foreground">{h.message}</li>)}
          {t.recommendations.length === 0 && t.holds.length === 0 && t.leadsUsed > 0 ? <li className="text-xs text-muted-foreground">No time of day stands out with enough leads behind it. Recommendations appear only when a time band has at least the default number of leads.</li> : null}
        </ul>
      </Panel>
    </div>
  );
}

const FLAG: Record<PacingRow["flag"], { label: string; variant: "success" | "warning" | "outline" | "destructive" }> = { on_track: { label: "On track", variant: "success" }, overspend: { label: "Overspending", variant: "destructive" }, underspend: { label: "Underspending", variant: "warning" }, no_plan: { label: "No plan set", variant: "outline" }, too_early: { label: "Too early", variant: "outline" }, no_data: { label: "No data", variant: "outline" } };

export function PacingTab({ rows, planForm }: { rows: PacingRow[]; planForm: (r: PacingRow) => React.ReactNode }) {
  return (
    <ScrollBox label="Monthly pacing per campaign">
      <table className="w-full text-sm">
        <caption className="sr-only">Monthly pacing per campaign</caption>
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Campaign</th><th scope="col" className="py-2 pr-3 text-right font-medium">Planned</th><th scope="col" className="py-2 pr-3 text-right font-medium">Spent so far</th><th scope="col" className="py-2 pr-3 text-right font-medium">Projected month end</th><th scope="col" className="py-2 font-medium">Status</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.campaignId} className="border-b align-top">
              <th scope="row" className="py-2 pr-3 text-left font-medium">{r.campaignName}</th>
              <td className="py-2 pr-3 text-right">{planForm(r)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{inr(r.spendToDate)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.projected === null ? "n/a" : <>{inr(r.projected)}<span className="block text-xs text-muted-foreground">{r.variance !== null ? `${r.variance >= 0 ? "+" : ""}${pct(r.variance)} vs plan` : ""}</span></>}</td>
              <td className="py-2"><Badge variant={FLAG[r.flag].variant}>{FLAG[r.flag].label}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Projection: spend so far plus the last seven days&apos; average for each remaining day. Over means more than 10% above plan; under means more than 15% below (defaults).</p>
    </ScrollBox>
  );
}

export function RegionsTab({ cities, states }: { cities: RegionReport; states: RegionReport }) {
  const block = (title: string, r: RegionReport) => (
    <Panel title={title} description="Ranked by what a FUNDED customer costs, then by AUM and revenue per rupee spent.">
      {!r.spendAvailable ? <NotAvailable>Spend by region is not reported by the platforms yet, so costs cannot be shown. Leads and funded customers are listed below.</NotAvailable> : null}
      <ScrollBox label={title}>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Region</th><th scope="col" className="py-2 pr-3 text-right font-medium">Leads</th><th scope="col" className="py-2 pr-3 text-right font-medium">Funded</th><th scope="col" className="py-2 pr-3 text-right font-medium">Cost per funded</th><th scope="col" className="py-2 pr-3 text-right font-medium">AUM per rupee</th><th scope="col" className="py-2 text-right font-medium">Revenue per rupee</th></tr></thead>
          <tbody>
            {[...r.byCostPerFunded, ...r.all.filter((x) => x.costPerFunded === null)].slice(0, 12).map((x) => (
              <tr key={x.name} className="border-b">
                <th scope="row" className="py-2 pr-3 text-left font-medium">{x.name}{x.note ? <span className="block text-xs font-normal text-muted-foreground">{x.note}</span> : null}</th>
                <td className="py-2 pr-3 text-right tabular-nums">{x.leads}</td><td className="py-2 pr-3 text-right tabular-nums">{x.funded}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{x.costPerFunded === null ? "n/a" : inr(x.costPerFunded)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{x.aumPerRupee === null ? "n/a" : x.aumPerRupee.toFixed(1)}</td>
                <td className="py-2 text-right tabular-nums">{x.revenuePerRupee === null ? "n/a" : x.revenuePerRupee.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
    </Panel>
  );
  return <div className="space-y-4">{block("Top cities", cities)}{block("Top states", states)}</div>;
}

export function AuctionTab({ a }: { a: AuctionReport }) {
  if (!a.available) return <NotAvailable>{a.reason}</NotAvailable>;
  return (
    <div className="space-y-4">
      {a.campaigns.map((c) => (
        <Panel key={c.campaignId} title={c.campaignName} description={c.yourImpressionShare === null ? "Your impression share: not available" : `Your impression share: ${pct(c.yourImpressionShare)}`}>
          <ScrollBox label={`Auction insights for ${c.campaignName}`}>
            <table className="w-full text-sm">
              <caption className="sr-only">Auction insights for {c.campaignName}</caption>
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Competitor</th><th scope="col" className="py-2 pr-3 text-right font-medium">Impression share</th><th scope="col" className="py-2 pr-3 text-right font-medium">Overlap</th><th scope="col" className="py-2 pr-3 text-right font-medium">Above you</th><th scope="col" className="py-2 text-right font-medium">You outrank</th></tr></thead>
              <tbody>{c.competitors.map((x) => <tr key={x.competitor} className="border-b"><th scope="row" className="py-2 pr-3 text-left font-medium">{x.competitor}</th><td className="py-2 pr-3 text-right tabular-nums">{pct(x.impressionShare)}</td><td className="py-2 pr-3 text-right tabular-nums">{pct(x.overlapRate)}</td><td className="py-2 pr-3 text-right tabular-nums">{pct(x.positionAboveRate)}</td><td className="py-2 text-right tabular-nums">{pct(x.outrankingShare)}</td></tr>)}</tbody>
            </table>
          </ScrollBox>
        </Panel>
      ))}
    </div>
  );
}

export function TrackingTab({ r }: { r: TrackingReport }) {
  if (!r.available) return <NotAvailable>Conversion tracking signals are not connected yet, so double counting, missing events and failed uploads cannot be checked.</NotAvailable>;
  if (r.findings.length === 0) return <p className="text-sm">No tracking problems found in the last 7 days: events are firing once each and offline uploads are being accepted.</p>;
  return (
    <ul className="space-y-2">
      {r.findings.map((f, i) => (
        <li key={i} className="rounded-xl border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5"><Badge variant={f.severity === "critical" ? "destructive" : f.severity === "high" ? "warning" : "secondary"}>{f.severity}</Badge><span className="text-xs text-muted-foreground">{f.subject}</span></div>
          <p className="mt-1">{f.message}</p><p className="mt-0.5 text-xs text-muted-foreground">{f.evidence.join(" · ")}</p>
        </li>
      ))}
    </ul>
  );
}
