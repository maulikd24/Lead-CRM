import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/** Shown when an active client has no open task — the CRM's "no next action" hygiene gap. */
export function HygieneWarningBadge() {
  return (
    <Badge variant="destructive" title="No open task for this active client">
      <AlertTriangle className="size-3" />
      No Next Action
    </Badge>
  );
}
