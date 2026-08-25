import type { Client, FundingRecord } from "@/generated/prisma/client";

export type CrossSellFlag = { label: string; reason: string };

const HIGH_INVESTMENT_THRESHOLD = 1_000_000;

type CrossSellInput = Pick<
  Client,
  "status" | "clientType" | "productInterest" | "existingBroker" | "tradingExperience" | "expectedInvestment"
> & { fundingRecord: Pick<FundingRecord, "status" | "amount"> | null };

/**
 * Simple, explicitly-labeled heuristics over existing client data — not a prediction model.
 * All source fields are free-text, so matching is substring-based rather than enum comparison.
 */
export function getCrossSellFlags(client: CrossSellInput): CrossSellFlag[] {
  const flags: CrossSellFlag[] = [];

  const investmentAmount = Number(client.expectedInvestment ?? 0) || Number(client.fundingRecord?.amount ?? 0);
  if (client.status === "COMPLETED" && investmentAmount >= HIGH_INVESTMENT_THRESHOLD) {
    flags.push({
      label: "Consider premium advisory / PMS",
      reason: `High investment capacity (₹${investmentAmount.toLocaleString("en-IN")})`,
    });
  }

  const experience = (client.tradingExperience ?? "").toLowerCase();
  const interest = (client.productInterest ?? "").toLowerCase();
  const mentionsDerivatives = interest.includes("f&o") || interest.includes("derivative") || interest.includes("future") || interest.includes("option");
  if ((experience.includes("experien") || experience.includes("advanced")) && !mentionsDerivatives) {
    flags.push({
      label: "Consider derivatives / F&O offering",
      reason: "Client has trading experience but no derivatives interest on file",
    });
  }

  if (client.existingBroker && client.status === "COMPLETED") {
    flags.push({
      label: "Consider consolidation pitch",
      reason: `Switched from an existing broker (${client.existingBroker})`,
    });
  }

  return flags;
}
