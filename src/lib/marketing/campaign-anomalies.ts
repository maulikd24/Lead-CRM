/**
 * Campaign anomalies from the aggregate daily ad numbers (AdCampaignDaily). Pure and deliberately simple: three rules with a noise
 * floor, so the Marketing feed shows few, explainable items. Rows hold platform-reported aggregates only, never a person.
 */
export type DailyRow = { campaignId: string; campaignName: string; date: Date; spendMinor: number; leads: number; impressions: number; clicks: number };
export type AnomalyType = "spend_spike" | "spend_no_leads" | "spend_stopped";
export type Anomaly = { campaignId: string; campaignName: string; type: AnomalyType; severity: "medium" | "high"; detail: string };

/** Below this much daily spend (minor units, 500.00) a campaign is too small to judge. */
export const NOISE_FLOOR_MINOR = 50_000;
export const MIN_HISTORY_DAYS = 5;
export const SPIKE_RATIO = 2.5;
export const NO_LEAD_DAYS = 3;

const inr = (minor: number) => `${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function detectCampaignAnomalies(all: readonly DailyRow[], now: Date): Anomaly[] {
  const byCampaign = new Map<string, DailyRow[]>();
  for (const r of all) (byCampaign.get(r.campaignId) ?? byCampaign.set(r.campaignId, []).get(r.campaignId)!).push(r);
  const out: Anomaly[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const [campaignId, rowsRaw] of byCampaign) {
    // Complete days only, newest first: today is still filling in.
    const rows = rowsRaw.filter((r) => r.date.getTime() < today).sort((a, b) => b.date.getTime() - a.date.getTime());
    if (rows.length < MIN_HISTORY_DAYS) continue;
    const [latest, ...history] = rows;
    const name = latest.campaignName;
    const avg = history.slice(0, 7).reduce((s, r) => s + r.spendMinor, 0) / Math.min(7, history.length);
    if (avg >= NOISE_FLOOR_MINOR && latest.spendMinor >= avg * SPIKE_RATIO) {
      out.push({ campaignId, campaignName: name, type: "spend_spike", severity: "high", detail: `Spend of ${inr(latest.spendMinor)} yesterday against a recent daily average of ${inr(avg)}.` });
    }
    if (avg >= NOISE_FLOOR_MINOR && latest.spendMinor === 0) {
      out.push({ campaignId, campaignName: name, type: "spend_stopped", severity: "medium", detail: `No spend yesterday on a campaign that averaged ${inr(avg)} a day.` });
    }
    const recent = rows.slice(0, NO_LEAD_DAYS);
    if (recent.length === NO_LEAD_DAYS && recent.every((r) => r.spendMinor >= NOISE_FLOOR_MINOR && r.leads === 0)) {
      out.push({ campaignId, campaignName: name, type: "spend_no_leads", severity: "high", detail: `${inr(recent.reduce((s, r) => s + r.spendMinor, 0))} spent over ${NO_LEAD_DAYS} days with no leads reported.` });
    }
  }
  return out;
}
