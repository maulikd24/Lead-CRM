/**
 * Campaign anomalies from the aggregate daily ad numbers (AdCampaignDaily). Pure and deliberately simple: three rules with a noise
 * floor, so the Marketing feed shows few, explainable items. Rows hold platform-reported aggregates only, never a person.
 */
export type DailyRow = { campaignId: string; campaignName: string; date: Date; spendMinor: number; leads: number; impressions: number; clicks: number };
export type AnomalyType = "spend_spike" | "spend_no_leads" | "spend_stopped";
/** `detail` is the reason (what happened, with the numbers); `nextStep` is what to do about it. */
export type Anomaly = { campaignId: string; campaignName: string; type: AnomalyType; severity: "medium" | "high"; detail: string; nextStep: string };

/** One plain label and one next step per anomaly type: the Campaign anomalies page shows exactly these beside the reason. */
export const ANOMALY_COPY: Record<AnomalyType, { label: string; nextStep: string }> = {
  spend_spike: { label: "Spend spike", nextStep: "Open the campaign in the ad platform, check its budget and bids, and pause it if the spend was not planned." },
  spend_no_leads: { label: "Spend with no leads", nextStep: "Check that the lead form and tracking still work, then review the audience and the creative." },
  spend_stopped: { label: "Spend stopped", nextStep: "Check in the ad platform whether the campaign is paused, out of budget or rejected." },
};

/** Below this much daily spend (minor units, 500.00) a campaign is too small to judge. */
export const NOISE_FLOOR_MINOR = 50_000;
export const MIN_HISTORY_DAYS = 5;
export const SPIKE_RATIO = 2.5;
export const NO_LEAD_DAYS = 3;

const inr = (minor: number) => `${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function detectCampaignAnomalies(all: readonly DailyRow[], now: Date): Anomaly[] {
  // One row per campaign and day: an exact repeat (a re-sync) is dropped, and different rows for the same day (two accounts) are added together.
  const perDay = new Map<string, DailyRow>();
  const seen = new Set<string>();
  for (const r of all) {
    const exact = [r.campaignId, r.date.getTime(), r.spendMinor, r.leads, r.impressions, r.clicks].join("|");
    if (seen.has(exact)) continue;
    seen.add(exact);
    const key = `${r.campaignId}|${r.date.getTime()}`;
    const have = perDay.get(key);
    perDay.set(key, have ? { ...have, spendMinor: have.spendMinor + r.spendMinor, leads: have.leads + r.leads, impressions: have.impressions + r.impressions, clicks: have.clicks + r.clicks } : r);
  }
  const byCampaign = new Map<string, DailyRow[]>();
  for (const r of perDay.values()) (byCampaign.get(r.campaignId) ?? byCampaign.set(r.campaignId, []).get(r.campaignId)!).push(r);
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
      out.push({ campaignId, campaignName: name, type: "spend_spike", severity: "high", detail: `Spend of ${inr(latest.spendMinor)} yesterday against a recent daily average of ${inr(avg)}.`, nextStep: ANOMALY_COPY.spend_spike.nextStep });
    }
    if (avg >= NOISE_FLOOR_MINOR && latest.spendMinor === 0) {
      out.push({ campaignId, campaignName: name, type: "spend_stopped", severity: "medium", detail: `No spend yesterday on a campaign that averaged ${inr(avg)} a day.`, nextStep: ANOMALY_COPY.spend_stopped.nextStep });
    }
    const recent = rows.slice(0, NO_LEAD_DAYS);
    if (recent.length === NO_LEAD_DAYS && recent.every((r) => r.spendMinor >= NOISE_FLOOR_MINOR && r.leads === 0)) {
      out.push({ campaignId, campaignName: name, type: "spend_no_leads", severity: "high", detail: `${inr(recent.reduce((s, r) => s + r.spendMinor, 0))} spent over ${NO_LEAD_DAYS} days with no leads reported.`, nextStep: ANOMALY_COPY.spend_no_leads.nextStep });
    }
  }
  return out;
}
