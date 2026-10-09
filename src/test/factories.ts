import type { CustomerFacts } from "@/lib/intelligence/facts";

const DAY = 86_400_000;

export function makeFacts(over: Partial<CustomerFacts> = {}): CustomerFacts {
  const now = new Date("2026-10-09T10:00:00Z");
  const base = {
    now,
    client: {
      id: "c1", name: "Test Customer", clientCode: "CL-00001", status: "ACTIVE",
      createdAt: new Date(now.getTime() - 10 * DAY), assignedToId: "u1", customerCategory: null,
      clientType: null, investmentCategory: null, leadSource: null, productInterest: null,
      expectedInvestment: null, isReferral: false,
    },
    stage: { name: "KYC", sequence: 3, enteredAt: new Date(now.getTime() - 5 * DAY) },
    onboarding: { detail: "Waiting for KYC documents" },
    hasContacted: true,
    kycApproved: false,
    funding: { status: null, amount: null, paymentsIn: 0, firstPaymentAt: null },
    portfolio: { aum: 0, allocation: [], concentration: { flagged: false }, holds: [], positionCount: 0 },
    trading: { count: 0, first: null, last: null, last90: 0, hasSip: false },
    wealth: { checkupStatus: null, checkupCompletedAt: null, riskProfile: null, pmsAifInvested: [] },
    opportunities: [], insights: [], manualAcceptance: [], outcomes: [],
    intel: { dematTransferStatus: null, mfTransferStatus: null, externalPortfolio: null, mfTransfer: null, idleCash: null },
    negativeReviewRecent: false, lastActivityAt: null, overdueTasks: 0,
  };
  return { ...(base as unknown as CustomerFacts), ...over };
}
