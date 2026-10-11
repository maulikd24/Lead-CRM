import { emitEvent, emitEventInTx, type EventTx } from "./emit-db";
import type { EmitInput } from "./envelope";
import { customerEventsEnabled } from "./flag";
import * as b from "./producers";

/**
 * Thin, flag-aware wrappers around the builders: `void emitX(...)` at a call site. With CUSTOMER_EVENTS_ENABLED off every one returns immediately without
 * building anything or touching the database; with it on they store best effort and never throw (see emit.ts). Use the `...InTx` form where the event and
 * the domain write must commit together.
 */
const send = async (input: EmitInput | null): Promise<void> => { if (input && customerEventsEnabled()) await emitEvent(input); };
const sendTx = async (tx: EventTx, input: EmitInput | null): Promise<void> => { if (input && customerEventsEnabled()) await emitEventInTx(tx, input); };

export const emitLeadCreated = (p: Parameters<typeof b.buildLeadCreated>[0]) => (customerEventsEnabled() ? send(b.buildLeadCreated(p)) : Promise.resolve());
export const emitLeadAssigned = (p: Parameters<typeof b.buildLeadAssigned>[0]) => (customerEventsEnabled() ? send(b.buildLeadAssigned(p)) : Promise.resolve());
export const emitLeadContacted = (p: Parameters<typeof b.buildLeadContacted>[0]) => (customerEventsEnabled() ? send(b.buildLeadContacted(p)) : Promise.resolve());
export const emitLeadLost = (p: Parameters<typeof b.buildLeadLost>[0]) => (customerEventsEnabled() ? send(b.buildLeadLost(p)) : Promise.resolve());
export const emitStageChanged = (p: Parameters<typeof b.buildStageChanged>[0]) => (customerEventsEnabled() ? send(b.buildStageChanged(p)) : Promise.resolve());
export const emitKycStarted = (p: Parameters<typeof b.buildKycStarted>[0]) => (customerEventsEnabled() ? send(b.buildKycStarted(p)) : Promise.resolve());
export const emitKycDecision = (p: Parameters<typeof b.buildKycDecision>[0]) => (customerEventsEnabled() ? send(b.buildKycDecision(p)) : Promise.resolve());
export const emitAccountFunded = (p: Parameters<typeof b.buildAccountFunded>[0]) => (customerEventsEnabled() ? send(b.buildAccountFunded(p)) : Promise.resolve());
export const emitTransactionRecorded = (p: Parameters<typeof b.buildTransactionRecorded>[0]) => (customerEventsEnabled() ? send(b.buildTransactionRecorded(p)) : Promise.resolve());
export const emitTicketCreated = (p: Parameters<typeof b.buildTicketCreated>[0]) => (customerEventsEnabled() ? send(b.buildTicketCreated(p)) : Promise.resolve());
export const emitComplaintRaised = (p: Parameters<typeof b.buildComplaintRaised>[0]) => (customerEventsEnabled() ? send(b.buildComplaintRaised(p)) : Promise.resolve());
export const emitWhatsappMessage = (p: Parameters<typeof b.buildWhatsappMessage>[0]) => (customerEventsEnabled() ? send(b.buildWhatsappMessage(p)) : Promise.resolve());
export const emitCallLoggedInTx = (tx: EventTx, p: Parameters<typeof b.buildCallLogged>[0]) => (customerEventsEnabled() ? sendTx(tx, b.buildCallLogged(p)) : Promise.resolve());
export const emitCampaignLeadAttributed = (p: Parameters<typeof b.buildCampaignLeadAttributed>[0]) => (customerEventsEnabled() ? send(b.buildCampaignLeadAttributed(p)) : Promise.resolve());
export const emitCampaignLeadPushed = (p: Parameters<typeof b.buildCampaignLeadPushed>[0]) => (customerEventsEnabled() ? send(b.buildCampaignLeadPushed(p)) : Promise.resolve());
export const emitCampaignLeadSlaBreached = (p: Parameters<typeof b.buildCampaignLeadSlaBreached>[0]) => (customerEventsEnabled() ? send(b.buildCampaignLeadSlaBreached(p)) : Promise.resolve());
export const emitSpeedToContactMeasured = (p: Parameters<typeof b.buildSpeedToContactMeasured>[0]) => (customerEventsEnabled() ? send(b.buildSpeedToContactMeasured(p)) : Promise.resolve());
export const emitCampaignFundedAttributed = (p: Parameters<typeof b.buildCampaignFundedAttributed>[0]) => (customerEventsEnabled() ? send(b.buildCampaignFundedAttributed(p)) : Promise.resolve());
export const emitReferralAttributedInTx = (tx: EventTx, p: Parameters<typeof b.buildReferralAttributed>[0]) => (customerEventsEnabled() ? sendTx(tx, b.buildReferralAttributed(p)) : Promise.resolve());
export const emitCustomerMergedInTx = (tx: EventTx, p: Parameters<typeof b.buildCustomerMerged>[0]) => (customerEventsEnabled() ? sendTx(tx, b.buildCustomerMerged(p)) : Promise.resolve());
export const emitLeadDeduplicated = (p: Parameters<typeof b.buildLeadDeduplicated>[0]) => (customerEventsEnabled() ? send(b.buildLeadDeduplicated(p)) : Promise.resolve());
export const emitReferralQualified = (p: Parameters<typeof b.buildReferralQualified>[0]) => (customerEventsEnabled() ? send(b.buildReferralQualified(p)) : Promise.resolve());

/** The feed row only knows its trading account: find the customer, and whether this is their first transaction (nothing earlier or equal on any of their accounts). Never throws. */
export async function emitTransactionForAccount(p: { transactionId: string; tradingAccountId: string; type: string; occurredAt: Date }): Promise<void> {
  if (!customerEventsEnabled()) return;
  try {
    const { prisma } = await import("@/lib/db/prisma");
    const account = await prisma.tradingAccount.findUnique({ where: { id: p.tradingAccountId }, select: { clientId: true } });
    if (!account) return;
    const earlier = await prisma.transaction.count({ where: { tradingAccount: { clientId: account.clientId }, id: { not: p.transactionId }, transactionDate: { lte: p.occurredAt } } });
    await send(b.buildTransactionRecorded({ clientId: account.clientId, transactionId: p.transactionId, type: p.type, first: earlier === 0, occurredAt: p.occurredAt }));
  } catch {
    // An event that cannot be built is never the feed's problem.
  }
}
export const emitMemoryEvent = (p: Parameters<typeof b.buildMemoryEvent>[0]) => (customerEventsEnabled() ? send(b.buildMemoryEvent(p)) : Promise.resolve());
export const emitDecisionEvent = (p: Parameters<typeof b.buildDecisionEvent>[0]) => (customerEventsEnabled() ? send(b.buildDecisionEvent(p)) : Promise.resolve());
