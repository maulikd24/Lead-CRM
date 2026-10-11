import { RailError } from "@/components/c360/rail-views";
import { auth } from "@/lib/auth/config";
import { ageLabel } from "@/lib/freshness/stale";
import { loadHouseholdContext, type HouseholdContext } from "@/lib/households/privacy/load";
import { getCustomerMemory } from "@/lib/memory/read";
import type { CustomerMemoryView } from "@/lib/memory/view";

import { MemoryPanel, type MemoryPanelData } from "./memory-panel";

async function load(clientId: string, now: Date): Promise<{ view: CustomerMemoryView; household: HouseholdContext | null } | null> {
  try {
    const session = await auth();
    if (!session?.user) return null;
    const viewer = { userId: session.user.id, role: session.user.role };
    const [view, household] = await Promise.all([getCustomerMemory(viewer, clientId, now), loadHouseholdContext(viewer, clientId)]);
    return view ? { view, household } : null;
  } catch (error) {
    console.error("Customer 360: memory failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

/** The Memory tab. getCustomerMemory authorises (registry area and the customer's record scope) and answers null when not allowed. */
export async function MemorySection({ clientId }: { clientId: string }) {
  const now = new Date();
  const loaded = await load(clientId, now);
  if (!loaded) return <RailError what="what we know" />;
  const { view, household } = loaded;
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
}
