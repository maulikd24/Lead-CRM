export type ProposalStatus = "DRAFT" | "APPROVED" | "SENT" | "REJECTED" | "EXPIRED" | "BLOCKED";

const ALLOWED: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ["APPROVED", "REJECTED", "EXPIRED", "BLOCKED"],
  APPROVED: ["SENT", "BLOCKED", "DRAFT", "EXPIRED"], // DRAFT: release the claim when the send failed before a message was created.
  // EXPIRED: the sweeper found a stuck claim (process died mid-send, no message exists) whose draft has also expired.
  SENT: [],
  REJECTED: [],
  EXPIRED: [],
  BLOCKED: [],
};

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal proposal transition ${from} -> ${to}`);
}
