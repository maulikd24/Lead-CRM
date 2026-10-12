/** Helpdesk ticket states that mean "done". Anything else (open, pending, on hold, unknown) still needs someone. */
export const CLOSED_TICKET_STATES: ReadonlySet<string> = new Set(["resolved", "closed"]);

export function isOpenTicket(status: string | null): boolean {
  return !CLOSED_TICKET_STATES.has((status ?? "").toLowerCase());
}
