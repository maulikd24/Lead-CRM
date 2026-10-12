import type { BlendedTotals } from "./blend";
import type { AdChannel } from "./channels";
import { formatCount, formatMoney, type ConnectionView } from "./view-model";

/** Small view-model helpers for the workspace tabs: the Overview numbers and the connection facts in the rail. Pure. */

export type OverviewKpi = { key: string; label: string; value: number | null; kind: "money" | "count" | "ratio"; hint: string; tone?: "success" | "warning" };

export function overviewKpis(t: BlendedTotals): OverviewKpi[] {
  return [
    { key: "spend", label: "Spend", value: t.spend, kind: "money", hint: `${formatCount(t.impressions)} impressions` },
    { key: "leads", label: "Leads in the CRM", value: t.crmLeads, kind: "count", hint: `${formatCount(t.kyc)} KYC approved` },
    { key: "cpl", label: "Cost per lead", value: t.cpl, kind: "money", hint: "Spend ÷ CRM leads" },
    { key: "funded", label: "Funded customers", value: t.funded, kind: "count", hint: t.funded > 0 && t.costPerFunded !== null ? `${formatMoney(t.costPerFunded, "INR")} each` : "No funded customers yet", tone: t.funded > 0 ? "success" : undefined },
    { key: "revenue", label: "Net revenue", value: t.revenue, kind: "money", hint: "Brokerage and fees, net of reversals" },
    { key: "roas", label: "Return on ad spend", value: t.roas, kind: "ratio", hint: t.roas === null ? "Shown once revenue is booked" : "Revenue ÷ spend (indicative)" },
  ];
}

export type ConnectionFact = { key: string; label: string; value: string; hint?: string; tone?: "success" | "warning" | "destructive"; live?: boolean };

export function channelFacts(channels: { channel: AdChannel; label: string; connection: Pick<ConnectionView, "state" | "banners" | "lastSyncLabel"> }[]): ConnectionFact[] {
  return channels.map(({ channel, label, connection }) => {
    const key = `conn-${channel}`;
    const name = `${label} Ads`;
    if (connection.state === "not_connected") return { key, label: name, value: "Not connected", tone: "warning" as const, hint: "An Admin can connect it in Settings" };
    if (connection.state === "waiting") return { key, label: name, value: "Waiting for first sync" };
    const hint = connection.lastSyncLabel ? `Last sync ${connection.lastSyncLabel}` : undefined;
    if (connection.banners.some((b) => b.tone === "destructive")) return { key, label: name, value: "Sync failing", tone: "destructive" as const, hint, live: false };
    if (connection.banners.some((b) => b.tone === "warning")) return { key, label: name, value: "Needs attention", tone: "warning" as const, hint, live: false };
    return { key, label: name, value: "Live", tone: "success" as const, hint, live: true };
  });
}
