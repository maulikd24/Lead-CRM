import type { CustomerFacts } from "./facts";
import type { LifecycleStage } from "./constants";

const DAY = 24 * 60 * 60 * 1000;
export const DORMANT_AFTER_DAYS = 90;
export const ACTIVATED_WINDOW_DAYS = 30;

/** Lead / signup → contact → KYC → value unlock → fund / transfer → first transaction → ongoing relationship. */
export function computeLifecycleStage(f: CustomerFacts): LifecycleStage {
  if (f.client.status === "NOT_PROCEEDING") return "Lost";

  if (f.trading.count > 0 && f.trading.last) {
    if (f.now.getTime() - f.trading.last.getTime() > DORMANT_AFTER_DAYS * DAY) return "Dormant";
    if (f.trading.first && f.now.getTime() - f.trading.first.getTime() <= ACTIVATED_WINDOW_DAYS * DAY) return "Activated";
    return "Active";
  }

  const fundedOrTransferred =
    f.funding.status === "PARTIALLY_FUNDED" ||
    f.funding.status === "FULLY_FUNDED" ||
    f.funding.paymentsIn > 0 ||
    f.intel.dematTransferStatus === "COMPLETED" ||
    f.intel.mfTransferStatus === "COMPLETED";
  if (fundedOrTransferred) return "Funded";
  if (f.kycApproved) return "Value unlock";
  if (f.stage.sequence >= 2) return "KYC";
  if (f.hasContacted) return "Contacted";
  return "Lead";
}
