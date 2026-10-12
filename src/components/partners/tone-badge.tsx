import { Badge } from "@/components/ui/badge";
import type { Badge as BadgeVM } from "@/lib/partners/view-models";

const VARIANT = { default: "secondary", success: "success", warning: "warning", destructive: "destructive" } as const;

export function ToneBadge({ badge }: { badge: BadgeVM }) {
  return <Badge variant={VARIANT[badge.tone]}>{badge.label}</Badge>;
}
