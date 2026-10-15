import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { loadAttentionFeed } from "@/lib/attention/feed";
import { attentionEngineEnabled } from "@/lib/attention/flag";
import { requireMarketing } from "@/lib/auth/require-role";
import { campaignAttentionSource } from "@/lib/marketing/campaign-attention";
import { AnomalyTable } from "./anomaly-table";
import { setCampaignAttentionAction } from "./actions";

export const dynamic = "force-dynamic";

/** Marketing's Needs attention: campaign anomalies and nothing else (the engine's role table gives MARKETING that one kind). Aggregate platform numbers only. */
export default async function MarketingAttentionPage() {
  const session = await requireMarketing("attention-marketing");
  if (!attentionEngineEnabled()) notFound();
  const feed = await loadAttentionFeed(session.user.id, session.user.role, new Date(), { extraSources: [campaignAttentionSource] });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader title="Campaign anomalies" description="One row per anomaly, with why it is here and what to do next. Aggregate numbers only." />
      <AnomalyTable items={feed.items} act={setCampaignAttentionAction} emptyTitle="No campaign anomalies right now." />
    </div>
  );
}
