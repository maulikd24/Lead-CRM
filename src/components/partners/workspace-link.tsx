import Link from "next/link";
import { Network } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { resolvePartnerSource } from "@/lib/partners/source";

/**
 * A way into the Partner workspace for partner users and team managers, who live on their own home pages. Shown only when
 * the workspace is on and reads from this CRM (the native source), the one case in which those roles may open it.
 */
export function PartnerWorkspaceLink() {
  if (!isPartnerWorkspaceEnabled() || resolvePartnerSource() !== "native") return null;
  return (
    <Button size="sm" variant="outline" render={<Link href="/partners" />}>
      <Network /> Partner workspace
    </Button>
  );
}
