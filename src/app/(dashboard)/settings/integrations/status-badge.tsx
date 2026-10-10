import { Badge } from "@/components/ui/badge";
import { STATE_LABEL, type IntegrationState } from "@/lib/integrations/overview";

const VARIANT = { connected: "success", needs_setup: "warning", flag_off: "outline" } as const;

/** The one status an integration has: connected, needs setup, or flag off. Words, not only colour. */
export function StateBadge({ state }: { state: IntegrationState }) {
  return <Badge variant={VARIANT[state]}>{STATE_LABEL[state]}</Badge>;
}
