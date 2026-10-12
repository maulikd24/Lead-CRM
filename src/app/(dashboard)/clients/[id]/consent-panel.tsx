import { prisma } from "@/lib/db/prisma";
import { ConsentPanelView, type HistoryItem } from "./consent-panel-view";
import { buildPanelRows } from "@/lib/consent/view";
import { resolvePolicy } from "@/lib/consent/policy";

const HISTORY_LIMIT = 50;

/** Server loader for the customer page. Rendered only when NEXT_PUBLIC_CONSENT=1. */
export async function ConsentPanel({ clientId, legacyMarketingConsentAt, canEdit }: { clientId: string; legacyMarketingConsentAt: Date | null; canEdit: boolean }) {
  const records = await prisma.consentRecord.findMany({ where: { clientId }, orderBy: { capturedAt: "desc" }, take: 500 });
  const actorIds = [...new Set(records.slice(0, HISTORY_LIMIT).flatMap((r) => (r.capturedById ? [r.capturedById] : [])))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(actors.map((a) => [a.id, a.name]));

  const rows = buildPanelRows(records, legacyMarketingConsentAt, new Date(), resolvePolicy(process.env));
  const history: HistoryItem[] = records.slice(0, HISTORY_LIMIT).map((r) => ({
    id: r.id, at: r.capturedAt, purpose: r.purpose, channel: r.channel, status: r.status, source: r.source,
    by: r.capturedById ? (nameById.get(r.capturedById) ?? null) : null, reason: r.reason,
  }));
  return <ConsentPanelView rows={rows} history={history} canEdit={canEdit} clientId={clientId} />;
}
