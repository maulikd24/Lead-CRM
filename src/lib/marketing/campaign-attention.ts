import type { AttentionCandidate } from "@/lib/attention/engine";
import type { ExtraSource } from "@/lib/attention/sources";

import type { Anomaly } from "./campaign-anomalies";
import { loadCampaignAnomalies } from "./campaign-anomalies-db";

/** An Anomaly as an AttentionCandidate: a campaign subject, no owner, aggregate numbers only. */
export function campaignCandidate(a: Pick<Anomaly, "campaignId" | "campaignName" | "type" | "severity" | "detail">, now: Date): AttentionCandidate {
  const high = a.severity === "high";
  return {
    kind: "campaign_anomaly", subKind: a.type, sourceRef: `${a.campaignId}:${a.type}`, subject: { type: "campaign", id: a.campaignId, label: a.campaignName }, ownerUserId: null,
    title: `${a.campaignName}: ${a.type === "spend_spike" ? "spend spike" : a.type === "spend_no_leads" ? "spend with no leads" : "spend stopped"}`, detail: a.detail,
    importance: high ? 4 : 3, urgency: high ? 4 : 3, risk: high ? 4 : 3, confidence: "high", confirmed: true, valueBand: "unknown", occurredAt: now, override: "none", href: "/marketing",
  };
}

/** Handed to loadAttentionFeed by the Marketing pages only (customer-side code may not import the marketing module). */
export const campaignAttentionSource: ExtraSource = {
  name: "campaign anomalies",
  kinds: ["campaign_anomaly"],
  run: async (_scope, now) => (await loadCampaignAnomalies(now)).map((a) => campaignCandidate(a, now)),
};
