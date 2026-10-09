import { handoffEnabled } from "@/lib/integrations/freshdesk/flags";
import { loadClientHandoffs } from "@/lib/integrations/freshdesk/support-data";
import { HandoffTicketsCard } from "./handoff-tickets-card";

/** Server wrapper for the customer page: one line there, nothing at all unless FRESHDESK_HANDOFF_ENABLED=1. */
export async function HandoffTicketsSection({ clientId }: { clientId: string }) {
  if (!handoffEnabled()) return null;
  const tickets = await loadClientHandoffs(clientId);
  return <HandoffTicketsCard tickets={tickets} now={new Date()} />;
}
