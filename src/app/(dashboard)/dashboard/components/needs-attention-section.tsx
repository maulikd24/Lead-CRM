import { NeedsAttentionFeed } from "@/components/attention/needs-attention-feed";
import { loadAttentionFeed } from "@/lib/attention/feed";
import { setAttentionAction } from "../attention-actions";

/** The Attention Engine feed for Today and the dashboard (flag NEXT_PUBLIC_ATTENTION_ENGINE): scoped to the viewer by the engine itself. */
export async function NeedsAttentionSection({ userId, role }: { userId: string; role: string }) {
  const feed = await loadAttentionFeed(userId, role);
  return <NeedsAttentionFeed feed={feed} showOwner={role !== "RM"} act={setAttentionAction} />;
}
