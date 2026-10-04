import type { KycStepType } from "@/generated/prisma/client";

/** What a provider sees. Identity data goes *to* the provider; only a non-PII summary comes back. */
export type KycCheckInput = {
  type: KycStepType;
  /** The provider's request id from a previous run — set when re-checking an asynchronous step (e-Sign, VIPV). */
  providerRef: string | null;
  person: { name: string; pan: string | null; mobile: string | null; email: string | null };
};

export type KycCheckOutcome =
  | { status: "VERIFIED"; providerRef?: string; result?: Record<string, string | number | boolean> }
  | { status: "FAILED"; providerRef?: string; failureReason: string; result?: Record<string, string | number | boolean> }
  /** Started, waiting on the client (e.g. an e-Sign link was sent). Re-run later with the returned providerRef. */
  | { status: "IN_PROGRESS"; providerRef: string; result?: Record<string, string | number | boolean> };

export interface KycProvider {
  key: string;
  label: string;
  supports(type: KycStepType): boolean;
  run(input: KycCheckInput): Promise<KycCheckOutcome>;
}

const PAN_INDIVIDUAL = /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/;

/** Deterministic stand-in for a verification vendor, for local and Preview testing:
 *  - PAN verifies only for an individual's PAN (4th letter "P"); anything else fails.
 *  - IPV and e-Sign are asynchronous: the first run returns IN_PROGRESS, a re-run completes them.
 *  - Any person whose name contains "mockfail" fails every check — to exercise the failure path.
 *  Risk profiling is a questionnaire, so it stays manual. */
export const mockKycProvider: KycProvider = {
  key: "mock",
  label: "Mock provider (testing only)",
  supports: (type) => type !== "RISK_PROFILE",
  async run({ type, providerRef, person }): Promise<KycCheckOutcome> {
    const ref = providerRef ?? `mock_${type.toLowerCase()}_${Date.now().toString(36)}`;
    if (person.name.toLowerCase().includes("mockfail")) {
      return { status: "FAILED", providerRef: ref, failureReason: "Mock provider: forced failure" };
    }
    switch (type) {
      case "PAN_VERIFICATION":
        if (!person.pan) return { status: "FAILED", providerRef: ref, failureReason: "No PAN on file" };
        if (!PAN_INDIVIDUAL.test(person.pan)) return { status: "FAILED", providerRef: ref, failureReason: "PAN is not valid for an individual" };
        return { status: "VERIFIED", providerRef: ref, result: { panStatus: "VALID", nameMatch: true } };
      case "ADDRESS_VERIFICATION":
        return { status: "VERIFIED", providerRef: ref, result: { source: "DIGILOCKER" } };
      case "BANK_VERIFICATION":
        return { status: "VERIFIED", providerRef: ref, result: { accountExists: true, nameMatchScore: 96 } };
      case "IPV":
      case "ESIGN":
        // First run: link sent to the client. Re-run: the client has completed it.
        return providerRef ? { status: "VERIFIED", providerRef: ref, result: { completed: true } } : { status: "IN_PROGRESS", providerRef: ref, result: { linkSent: true } };
      case "KRA":
        return { status: "VERIFIED", providerRef: ref, result: { kraStatus: "UPLOADED" } };
      case "CKYC":
        return { status: "VERIFIED", providerRef: ref, result: { ckycStatus: "UPLOADED" } };
      default:
        return { status: "FAILED", providerRef: ref, failureReason: `Mock provider does not handle ${type}` };
    }
  },
};

const PROVIDERS: Record<string, KycProvider> = { mock: mockKycProvider };

/** The automation provider configured by KYC_AUTOMATION_PROVIDER (a real vendor adapter is added to PROVIDERS).
 * Unset = everything is manual. The mock provider is refused in Production so it can never verify a real client. */
export function getKycProvider(env: NodeJS.ProcessEnv = process.env): KycProvider | null {
  const key = env.KYC_AUTOMATION_PROVIDER;
  if (!key) return null;
  const provider = PROVIDERS[key];
  if (!provider) {
    console.error(`KYC_AUTOMATION_PROVIDER="${key}" is not a known provider`);
    return null;
  }
  if (provider === mockKycProvider && env.VERCEL_ENV === "production") {
    console.error("The mock KYC provider is disabled in Production");
    return null;
  }
  return provider;
}
