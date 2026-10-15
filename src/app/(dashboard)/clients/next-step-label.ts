import { canViewClient } from "@/lib/clients/access";
import { getNextBestAction } from "@/lib/copilot/next-best-action";
import type { CopilotClient } from "@/lib/copilot/types";

/**
 * The "Next step" label the client record's rail shows. The clients list calls this same function, so the two
 * cannot disagree. Returns null when the viewer cannot open the client, using the same access rule as the record.
 */
export function nextStepLabelForViewer(
  client: CopilotClient,
  role: string,
  visibleUserIds: string[] | null,
): string | null {
  if (!canViewClient(role, visibleUserIds, client)) return null;
  return getNextBestAction(client).label;
}
