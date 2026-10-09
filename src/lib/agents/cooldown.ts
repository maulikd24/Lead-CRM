import type { Prisma } from "@/generated/prisma/client";
import type { ProposalStatus } from "./proposal-state";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** After a nudge was actually sent, leave the customer alone for this long. */
export const SENT_COOLDOWN_MS = 7 * DAY;
/** An RM who rejected a draft is telling us it was wrong for this customer: wait longer than after a send. */
export const REJECTED_COOLDOWN_MS = 14 * DAY;
/** A draft the guardrail or judge blocked: retry tomorrow, not every tick (each retry costs vendor calls). */
export const BLOCKED_COOLDOWN_MS = 1 * DAY;
/** The longest window above; the Prisma side never needs to read older rows. */
export const COOLDOWN_LOOKBACK_MS = Math.max(SENT_COOLDOWN_MS, REJECTED_COOLDOWN_MS, BLOCKED_COOLDOWN_MS);

/** The ONE place the time-windowed rules live; isCoolingDown and the Prisma pre-filter both read it, so they cannot drift. */
export const COOLDOWN_WINDOWS_MS = { SENT: SENT_COOLDOWN_MS, REJECTED: REJECTED_COOLDOWN_MS, BLOCKED: BLOCKED_COOLDOWN_MS } as const;

export type RecentProposal = { status: ProposalStatus; createdAt: Date; decidedAt: Date | null; expiresAt: Date };

/**
 * True when the customer must not get a new draft. Blocks on: an unexpired DRAFT, an APPROVED (in flight, never time-limited:
 * the sweeper resolves a stuck one), a SENT within 7 days, a REJECTED within 14 days, a BLOCKED within 1 day.
 * Age is measured from decidedAt, falling back to createdAt; a row exactly at the window edge no longer blocks.
 */
export function isCoolingDown(proposals: RecentProposal[], now: Date): boolean {
  const t = now.getTime();
  return proposals.some((p) => {
    const age = t - (p.decidedAt ?? p.createdAt).getTime();
    switch (p.status) {
      case "DRAFT": return p.expiresAt.getTime() > t;
      case "APPROVED": return true;
      case "SENT": case "REJECTED": case "BLOCKED": return age < COOLDOWN_WINDOWS_MS[p.status];
      default: return false;
    }
  });
}

/** Prisma form of isCoolingDown for one agent's proposals (same rules, including decidedAt ?? createdAt). */
export function blockingProposalWhere(now: Date): Prisma.AgentProposalWhereInput {
  const within = (ms: number): Prisma.AgentProposalWhereInput => {
    const cutoff = new Date(now.getTime() - ms);
    return { OR: [{ decidedAt: { gt: cutoff } }, { decidedAt: null, createdAt: { gt: cutoff } }] };
  };
  return {
    agentKey: "wa_nudger",
    OR: [
      { status: "DRAFT", expiresAt: { gt: now } },
      { status: "APPROVED" },
      ...(Object.keys(COOLDOWN_WINDOWS_MS) as (keyof typeof COOLDOWN_WINDOWS_MS)[]).map((status) => ({ status, ...within(COOLDOWN_WINDOWS_MS[status]) })),
    ],
  };
}
