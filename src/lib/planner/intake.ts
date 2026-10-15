import { extractCampaignCode } from "./capture";
import type { RoutingDecision } from "./routing";

/**
 * The lead intake's one call into the planner. A lead that arrives with a campaign code (in its tracked link or in the click-to-WhatsApp first
 * message) is given to the owner the plan's routing rules name, instead of the default assignment. Best effort by design: any problem returns null
 * and the existing assignment (region, language, capacity, round robin) decides exactly as it does today, so a plan can never lose a lead.
 */
export type IntakeRouteDeps = {
  enabled: () => boolean;
  ownerFor: (code: string, lead: { city?: string | null; language?: string | null; product?: string | null }) => Promise<{ decision: RoutingDecision; planId: string } | null>;
};

export type IntakeRoute = { assignedToId: string; planId: string; via: "rule" | "fallback"; code: string };

export async function routeCampaignLead(
  input: { attribution?: Record<string, string | undefined> | null; message?: string | null; city?: string | null; language?: string | null; productInterest?: string | null },
  deps: IntakeRouteDeps,
): Promise<IntakeRoute | null> {
  try {
    if (!deps.enabled()) return null;
    const code = extractCampaignCode({ attribution: input.attribution, message: input.message });
    if (!code) return null;
    const hit = await deps.ownerFor(code, { city: input.city, language: input.language, product: input.productInterest });
    if (!hit || !hit.decision.ownerId || hit.decision.via === "none") return null;
    return { assignedToId: hit.decision.ownerId, planId: hit.planId, via: hit.decision.via, code };
  } catch {
    return null;
  }
}
