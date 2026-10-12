import { cache } from "react";

import { RailError } from "@/components/c360/rail-views";
import { resolveDisclaimer } from "@/lib/outcomes/copy";
import { loadOutcomeBundles } from "@/lib/outcomes/loaders";
import { toOutcomesViewModel } from "@/lib/outcomes/view-model";
import { drafts } from "./drafts-flag";

import { OutcomesPanel } from "./outcomes-panel";

const getBundle = cache(async (clientId: string) => {
  try {
    return (await loadOutcomeBundles([clientId], new Date(), { includeInactiveGoals: true })).get(clientId) ?? null;
  } catch (error) {
    console.error("Customer 360: outcomes failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
});

/** The Goals and outcomes section. `clientId` and `canEdit` come from the page, which has already authorised the viewer. */
export async function OutcomesSection({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const bundle = await getBundle(clientId);
  if (!bundle) return <RailError what="goals and outcomes" />;
  return <OutcomesPanel vm={toOutcomesViewModel(bundle, { canEdit, draftsOn: drafts(), disclaimer: resolveDisclaimer() })} />;
}
