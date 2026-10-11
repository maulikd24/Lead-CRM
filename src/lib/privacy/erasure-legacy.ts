import type { prisma } from "@/lib/db/prisma";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * The ORIGINAL erasure steps, moved out of the server action unchanged (same statements, same order, same messages) so the relationship-registry
 * driven version (lib/relationships/erase.ts) can be proven equal to them and the switch can be flipped back at any time
 * (RELATIONSHIP_REGISTRY_ERASURE off = this code). Delete this file only after the registry path has run in production.
 */

/** Refuses the erasure when the customer (or a merged duplicate) has a financial or regulatory trail: archive instead. */
export async function legacyAssertErasable(tx: Tx, ids: string[]): Promise<void> {
  const [tradingAccountCount, householdMemberCount, revenueEventCount, advisoryInteractionCount, paymentCount] = await Promise.all([
    tx.tradingAccount.count({ where: { clientId: { in: ids } } }),
    tx.householdMember.count({ where: { clientId: { in: ids } } }),
    tx.revenueEvent.count({ where: { clientId: { in: ids } } }),
    tx.advisoryInteraction.count({ where: { clientId: { in: ids } } }),
    tx.clientPayment.count({ where: { clientId: { in: ids } } }),
  ]);
  // A PMS/AIF holding that was actually invested or redeemed is a financial record, like a trading account.
  if ((await tx.pmsAifHolding.count({ where: { clientId: { in: ids }, status: { not: "NOT_INVESTED" } } })) > 0) throw new Error("This client has PMS/AIF holdings on file — use Archive instead of permanent deletion.");
  if (tradingAccountCount > 0) throw new Error("This client has Trading Accounts on file — use Archive instead of permanent deletion.");
  if (householdMemberCount > 0) throw new Error("This client belongs to a Household — use Archive instead of permanent deletion.");
  if (revenueEventCount > 0) throw new Error("This client has Revenue Events on file — use Archive instead of permanent deletion.");
  if (paymentCount > 0) throw new Error("This client has Payments on file — use Archive instead of permanent deletion.");
  if (advisoryInteractionCount > 0) throw new Error("This client has Advisory Interactions on file — use Archive instead of permanent deletion.");
}

/** Deletes every restrict-foreign-key child in dependency order (the customer row itself is deleted by the caller afterwards). */
export async function legacyDeleteChildren(tx: Tx, ids: string[]): Promise<void> {
  // Delete every Restrict-FK child in dependency order, then the Client row itself.
  await tx.journeyRunStep.deleteMany({ where: { run: { clientId: { in: ids } } } });
  await tx.journeyRun.deleteMany({ where: { clientId: { in: ids } } });
  await tx.agentProposal.deleteMany({ where: { clientId: { in: ids } } }); // RESTRICT FK; messageId is a plain string, so no ordering dependency on Message
  await tx.cleverTapSync.deleteMany({ where: { clientId: { in: ids } } }); // RESTRICT FK would block the Client delete
  await tx.mergeSuggestion.deleteMany({ where: { OR: [{ clientAId: { in: ids } }, { clientBId: { in: ids } }] } }); // RESTRICT FKs (either side of the pair) would block the Client delete
  await tx.partnerReferralTouch.deleteMany({ where: { clientId: { in: ids } } }); // RESTRICT FK would block the Client delete
  await tx.partnerAttributionEvent.deleteMany({ where: { clientId: { in: ids } } }); // plain id, no FK: removed so the trail holds nothing about an erased person
  await tx.consentRecord.deleteMany({ where: { clientId: { in: ids } } }); // RESTRICT FK would block the Client delete (an append-only ledger still allows DELETE, for erasure)
  // Customer outcomes and goals (RESTRICT FKs; the free text in goals, reviews and dismissals can name the person).
  await tx.customerGoal.deleteMany({ where: { clientId: { in: ids } } });
  await tx.customerReview.deleteMany({ where: { clientId: { in: ids } } });
  await tx.suggestionDismissal.deleteMany({ where: { clientId: { in: ids } } });
  await tx.outcomeEvent.deleteMany({ where: { clientId: { in: ids } } });
  // Campaign attribution: the lead push holds the campaign context and the lead's own answers (RESTRICT FK).
  await tx.leadPush.deleteMany({ where: { clientId: { in: ids } } });
  // Referral programme. Referrer.clientId is a RESTRICT FK: the person's referrer record, its codes and everything they referred go first. The person's own
  // "referred by" row goes too. Reward ledger and statement rows hold only plain ids and amounts (no personal data) and stay as anonymous financial records.
  const referrerIds = (await tx.referrer.findMany({ where: { clientId: { in: ids } }, select: { id: true } })).map((r) => r.id);
  await tx.referralDevice.deleteMany({ where: { clientId: { in: ids } } }); // hashed devices (also cascade on the Client delete)
  await tx.referral.deleteMany({ where: { OR: [{ referredClientId: { in: ids } }, ...(referrerIds.length ? [{ referrerId: { in: referrerIds } }] : [])] } }); // events cascade
  await tx.referralCode.deleteMany({ where: { referrerId: { in: referrerIds } } });
  await tx.referrer.deleteMany({ where: { clientId: { in: ids } } });
  // Profiling and conversation-analysis rows (RESTRICT FKs; they quote the person). ConversationReview points at Task and Activity, so it goes before them.
  await tx.conversationReview.deleteMany({ where: { clientId: { in: ids } } });
  await tx.conversationInsight.deleteMany({ where: { clientId: { in: ids } } });
  await tx.interactionOutcome.deleteMany({ where: { clientId: { in: ids } } });
  await tx.customerIntelligence.deleteMany({ where: { clientId: { in: ids } } });
  await tx.smartAllvestProfile.deleteMany({ where: { clientId: { in: ids } } });
  await tx.segmentMembership.deleteMany({ where: { clientId: { in: ids } } });
  await tx.assetClassAcceptance.deleteMany({ where: { clientId: { in: ids } } });
  await tx.wealthHealthCheckup.deleteMany({ where: { clientId: { in: ids } } });
  await tx.pmsAifHolding.deleteMany({ where: { clientId: { in: ids } } }); // NOT_INVESTED placeholders only: an invested/redeemed holding already blocked the erasure above
  await tx.opportunityStageHistory.deleteMany({ where: { opportunity: { clientId: { in: ids } } } });
  await tx.opportunity.deleteMany({ where: { clientId: { in: ids } } });
  await tx.message.deleteMany({ where: { clientId: { in: ids } } });
  await tx.document.deleteMany({ where: { clientId: { in: ids } } });
  await tx.kycStep.deleteMany({ where: { clientId: { in: ids } } });
  await tx.supportTicket.deleteMany({ where: { clientId: { in: ids } } });
  await tx.accountHolder.deleteMany({ where: { clientId: { in: ids } } });
  await tx.task.deleteMany({ where: { clientId: { in: ids } } });
  await tx.deviceCall.deleteMany({ where: { clientId: { in: ids } } });
  await tx.activity.deleteMany({ where: { clientId: { in: ids } } });
  await tx.stageHistory.deleteMany({ where: { clientId: { in: ids } } });
  await tx.exception.deleteMany({ where: { clientId: { in: ids } } });
  await tx.kycRecord.deleteMany({ where: { clientId: { in: ids } } });
  await tx.fundingRecord.deleteMany({ where: { clientId: { in: ids } } });
  await tx.dealerIntroduction.deleteMany({ where: { clientId: { in: ids } } });
}
