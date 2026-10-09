import { AlertTriangle, BellRing, CircleAlert, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FLAG_LABEL, type FlagKind } from "@/lib/calls/view-model";

const ICON = { missed_followup: BellRing, compliance: ShieldAlert, incorrect_info: CircleAlert, complaint: AlertTriangle } as const;
const VARIANT = { missed_followup: "warning", compliance: "destructive", incorrect_info: "destructive", complaint: "warning" } as const;

export function FlagChips({ flags }: { flags: FlagKind[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Flags">
      {flags.map((f) => {
        const Icon = ICON[f];
        return (
          <li key={f}>
            <Badge variant={VARIANT[f]}>
              <Icon aria-hidden="true" />
              {FLAG_LABEL[f]}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
