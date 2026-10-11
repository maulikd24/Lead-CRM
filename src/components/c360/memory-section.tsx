import { RailError } from "@/components/c360/rail-views";
import { auth } from "@/lib/auth/config";
import { ageLabel } from "@/lib/freshness/stale";
import { loadHouseholdContext } from "@/lib/households/privacy/load";
import { getCustomerMemory } from "@/lib/memory/read";

import { MemoryPanel, type MemoryPanelData } from "./memory-panel";

/** The Memory tab. The viewer comes from the session; getCustomerMemory authorises (registry area and the customer's record scope) and answers null when not allowed. */
export async function MemorySection({ clientId }: { clientId: string }) {
  const session = await auth();
  if (!session?.user) return <RailError what="what we know" />;
  const viewer = { userId: session.user.id, role: session.user.role };
  const now = new Date();
  try {
    const [view, household] = await Promise.all([getCustomerMemory(viewer, clientId, now), loadHouseholdContext(viewer, clientId)]);
    if (!view) return <RailError what="what we know" />;
    const data: MemoryPanelData = {
      asOfAgo: view.asOf ? ageLabel(view.asOf, now) : null,
      empty: view.empty,
      canManage: view.canManage,
      doNotDo: view.doNotDo,
      needsConfirmation: view.needsConfirmation,
      groups: view.groups,
      counts: view.counts,
      household,
    };
    return <MemoryPanel clientId={clientId} data={data} />;
  } catch (error) {
    console.error("Customer 360: memory failed", error instanceof Error ? error.name : "unknown");
    return <RailError what="what we know" />;
  }
}
