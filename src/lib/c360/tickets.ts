export type TicketRow = { id: string; externalId: string; subject: string | null; status: string | null; priority: string | null; channel: string | null; ticketCreatedAt: Date | null; ticketUpdatedAt: Date | null };

export type TicketItem = { id: string; externalId: string; subject: string; status: string | null; statusLabel: string; priority: string | null; open: boolean; createdIso: string | null };
export type TicketsView = { total: number; openCount: number; shown: TicketItem[]; hiddenCount: number };

const CLOSED = new Set(["resolved", "closed"]);
const isOpen = (status: string | null) => !CLOSED.has((status ?? "").toLowerCase());

/** "waiting_on_customer" -> "Waiting on customer". */
export function statusLabel(status: string | null): string {
  const s = (status ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

/** Pure. Open tickets first, newest first inside each group, capped so the card stays short. */
export function buildTicketsView(rows: readonly TicketRow[], cap = 5): TicketsView {
  const time = (r: TicketRow) => r.ticketCreatedAt?.getTime() ?? 0;
  const sorted = [...rows].sort((a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)) || time(b) - time(a));
  return {
    total: rows.length,
    openCount: rows.filter((r) => isOpen(r.status)).length,
    shown: sorted.slice(0, cap).map((r) => ({
      id: r.id, externalId: r.externalId, subject: r.subject?.trim() || "(no subject)", status: r.status, statusLabel: statusLabel(r.status),
      priority: r.priority, open: isOpen(r.status), createdIso: r.ticketCreatedAt?.toISOString() ?? null,
    })),
    hiddenCount: Math.max(0, rows.length - cap),
  };
}
