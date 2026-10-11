import { DecisionCard } from "@/components/decision/decision-card";
import { drawerOffered } from "@/lib/intelligence/decision/access";
import { loadLatestDecisionFor } from "@/lib/intelligence/decision/review-db";

/**
 * The Decision Engine's shadow decision for this customer, with the Evidence Drawer. Renders nothing unless the screen flag is on and the
 * viewer may see decisions (Admin; Manager for their team; an RM for their own customers only with NBA_RM_VISIBLE on; nobody else).
 */
export async function DecisionPanel({ clientId, viewer, visibleUserIds }: { clientId: string; viewer: { id: string; role: string }; visibleUserIds: string[] | null }) {
  if (!drawerOffered(viewer.role)) return null;
  const loaded = await loadLatestDecisionFor(viewer, visibleUserIds, clientId);
  if (!loaded) return null;
  return <DecisionCard view={loaded.view} clientName={loaded.clientName} canAct={loaded.canAct} now={new Date().toISOString()} />;
}
