import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { RailError } from "@/components/c360/rail-views";
import { auth } from "@/lib/auth/config";
import { c360TabHref } from "@/lib/c360/tabs";
import { getServiceState, type ServiceState } from "@/lib/service/read";

import { ServicePanel, type ServicePanelData } from "./service-panel";

/** Loads the state for the signed-in viewer. Authorisation happens in getServiceState (registry area and the customer's record scope); null covers "not allowed" and "failed". */
async function load(clientId: string): Promise<ServiceState | null> {
  try {
    const session = await auth();
    if (!session?.user) return null;
    return await getServiceState({ userId: session.user.id, role: session.user.role }, clientId);
  } catch (error) {
    console.error("Customer 360: service failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

/** The Service tab. */
export async function ServiceSection({ clientId }: { clientId: string }) {
  const s = await load(clientId);
  if (!s) return <RailError what="complaints and promises" />;
  const data: ServicePanelData = { headline: s.headline, tone: s.tone, empty: s.empty, canManage: s.canManage, complaints: s.complaints, commitments: s.commitments, candidates: s.candidates, people: s.people, suggestedCommitments: s.suggestedCommitments };
  return <ServicePanel clientId={clientId} data={data} />;
}

/** The small Service strip in the Customer 360 header: one line, a link to the tab. Renders nothing when there is nothing to say or the viewer may not see it. */
export async function ServiceChip({ clientId }: { clientId: string }) {
  const s = await load(clientId);
  if (!s || s.openComplaints + s.overdueCommitments === 0) return null;
  const variant = s.tone === "critical" ? "destructive" : s.tone === "watch" ? "warning" : "secondary";
  return (
    <Badge variant={variant} render={<Link href={c360TabHref(clientId, "service")} aria-label={`Service: ${s.headline}. Open the Service tab`} />}>
      {s.headline}
    </Badge>
  );
}
