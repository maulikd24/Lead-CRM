import { LightWhilePrinting, PrintButton } from "@/components/partners/native/print-statement";
import { CHANNEL_NAME, type Delta, type DirectorReport } from "@/lib/director/report";
import { formatCount, formatMoney, formatRatio } from "@/lib/marketing/view-model";

/**
 * The director report as a page: every figure, no app chrome, built to read on a phone, print on A4 or be saved as a PDF.
 * Used by the signed-in printable page and by the shareable link. It carries aggregates only (channel, campaign name,
 * counts and rupees): no customer data of any kind. A figure that is not available says so; it is never shown as zero.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
const stamp = (iso: string) => `${new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;
const NA = "Not available";

function deltaText(d: Delta | undefined, money?: (n: number) => string): string | null {
  if (!d) return null;
  const sign = d.abs > 0 ? "up" : d.abs < 0 ? "down" : "unchanged";
  if (sign === "unchanged") return "unchanged";
  const amount = money ? money(Math.abs(d.abs)) : formatCount(Math.abs(d.abs));
  return `${sign} ${amount}${d.pct !== null ? ` (${Math.abs(Math.round(d.pct))}%)` : ""}`;
}

function Kpi({ label, value, delta, note }: { label: string; value: string; delta?: string | null; note?: string }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-xl font-extrabold tabular-nums">{value}</p>
      {delta && <p className="text-xs text-muted-foreground">{delta} vs the earlier period</p>}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section aria-label={title} className="break-inside-avoid">
      <h2 className="mb-1.5 font-heading text-base font-semibold">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="flex flex-col gap-1.5 text-sm">{items.map((t) => <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" /><span>{t}</span></li>)}</ul>}
    </section>
  );
}

export function ReportDocument({ report, shared, expiresAt }: { report: DirectorReport; shared?: boolean; expiresAt?: string }) {
  const money = (n: number | null) => (n === null ? NA : formatMoney(n, report.currency));
  const cnt = (n: number | null) => (n === null ? NA : formatCount(n));
  const t = report.totals.current;
  const d = report.totals.delta;
  const m = (n: number) => formatMoney(n, report.currency);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 bg-background p-5 text-foreground print:max-w-none print:p-0">
      <LightWhilePrinting />
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Marketing performance report</p>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">{day(report.period.from)} to {day(report.period.to)}</h1>
          <p className="text-sm text-muted-foreground">{report.comparePeriod ? `Compared with ${day(report.comparePeriod.from)} to ${day(report.comparePeriod.to)}. ` : ""}Prepared {stamp(report.generatedAt)}.{shared && expiresAt ? ` This link works until ${stamp(expiresAt)}.` : ""}</p>
        </div>
        <PrintButton />
      </header>

      {!report.hasData ? (
        <p role="note" className="rounded-lg border border-border p-4 text-sm">There is not enough connected data to report on this period. No figures are shown rather than estimated ones.</p>
      ) : (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Funded customers" value={cnt(t.funded)} delta={deltaText(d?.funded)} />
            <Kpi label="Revenue booked" value={money(t.revenue)} delta={deltaText(d?.revenue, m)} note="Net of reversals, from these customers" />
            <Kpi label="Ad spend" value={money(t.spend)} delta={deltaText(d?.spend, m)} />
            <Kpi label="Cost per funded customer" value={money(t.costPerFunded)} delta={deltaText(d?.costPerFunded, m)} note="Ad spend over funded customers from ads" />
            <Kpi label="Leads" value={cnt(t.leads)} delta={deltaText(d?.leads)} />
            <Kpi label="Revenue per rupee of ad spend" value={t.roas === null ? NA : formatRatio(t.roas)} note="Ad channels only" />
          </section>

          <div className="grid gap-5 sm:grid-cols-2 print:grid-cols-2">
            <List title="What went well" items={report.wins} empty="Nothing stood out as a clear win this period." />
            <List title="Watch" items={report.risks} empty="Nothing needs attention on the numbers we have." />
          </div>
          <List title="Suggested next steps" items={report.nextActions} empty="No next steps from this period's numbers." />

          <section aria-labelledby="by-channel" className="break-inside-avoid">
            <h2 id="by-channel" className="mb-2 font-heading text-base font-semibold">By channel</h2>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Spend, leads, KYC, funded customers, revenue and cost per funded customer for each channel</caption>
                <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Channel</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">Spend</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">Leads</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">KYC</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">Funded</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">Revenue</th><th scope="col" className="py-1.5 text-right font-medium">Cost per funded</th>
                </tr></thead>
                <tbody>
                  {report.channels.map((c) => (
                    <tr key={c.channel} className="break-inside-avoid border-b border-border/60">
                      <th scope="row" className="py-1.5 pr-3 text-left font-medium">{c.label}{!c.available && <span className="block text-[11px] font-normal text-muted-foreground">Not connected</span>}</th>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{c.available ? (c.channel === "referral" || c.channel === "partner" ? "Not tracked here" : money(c.current.spend)) : NA}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{cnt(c.current.leads)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{cnt(c.current.kyc)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{cnt(c.current.funded)}{c.previous?.funded != null && <span className="block text-[11px] text-muted-foreground">earlier {formatCount(c.previous.funded)}</span>}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(c.current.revenue)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(c.current.costPerFunded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {report.campaigns.length > 0 && (
            <section aria-labelledby="by-campaign">
              <h2 id="by-campaign" className="mb-2 font-heading text-base font-semibold">Top campaigns by revenue</h2>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">The campaigns with the most revenue, with spend, leads and funded customers</caption>
                  <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th scope="col" className="py-1.5 pr-3 font-medium">Campaign</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">Spend</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">Leads</th><th scope="col" className="py-1.5 pr-3 text-right font-medium">Funded</th><th scope="col" className="py-1.5 text-right font-medium">Revenue</th></tr></thead>
                  <tbody>
                    {report.campaigns.map((c) => (
                      <tr key={`${c.channel}:${c.campaignId}`} className="break-inside-avoid border-b border-border/60">
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">{c.name}<span className="block text-[11px] font-normal text-muted-foreground">{CHANNEL_NAME[c.channel]}</span></th>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money(c.spend)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{cnt(c.leads)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{cnt(c.funded)}</td><td className="py-1.5 text-right tabular-nums">{money(c.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section aria-labelledby="freshness" className="break-inside-avoid">
            <h2 id="freshness" className="mb-1.5 font-heading text-base font-semibold">How fresh the data is</h2>
            <ul className="flex flex-col gap-0.5 text-sm">
              {report.freshness.map((f) => (
                <li key={f.channel}>{f.label}: {f.channel === "meta" || f.channel === "google" ? (f.asOf ? `last synced ${stamp(f.asOf)}${f.ageHours !== null ? ` (${f.ageHours < 48 ? `${f.ageHours} hours` : `${Math.round(f.ageHours / 24)} days`} before this report)` : ""}` : "no sync time recorded") : "read from the CRM when this report was prepared"}{f.stale ? " (stale)" : ""}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      <footer className="break-inside-avoid border-t border-border pt-3 text-xs text-muted-foreground">
        <p>Funded customers and revenue follow the people who became customers in the period, wherever they are today, so the most recent days look lower than they will once those customers have had time to fund. A customer is counted once: someone who came through an ad stays with that ad channel even if a referral or partner code was also used. Spend for referrals and partners is not tracked here.</p>
        {report.notes.length > 0 && <p className="mt-1">{report.notes.join(" ")}</p>}
        <p className="mt-1">This report holds totals only: no customer names, contact details or identifiers. {shared ? "Management information for the recipients of this link; do not forward." : "Management information."}</p>
      </footer>
    </main>
  );
}
