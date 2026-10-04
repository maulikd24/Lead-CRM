import type { KycStepStatus, KycStepType } from "@/generated/prisma/client";

export const PRIMARY_HOLDER_KEY = "PRIMARY";

/** "same" = the dependency for the same holder; "primary" = the First Holder's (account-level) step;
 * "all" = that step for every holder that has it. */
type Dependency = { type: KycStepType; scope: "same" | "primary" | "all" };

export type KycStepDefinition = {
  type: KycStepType;
  label: string;
  description: string;
  /** Per-person steps are repeated for each joint holder; account-level steps exist once, on the First Holder. */
  perHolder: boolean;
  dependsOn: Dependency[];
  /** Drop-off threshold: hours a step may sit actionable before the RM is nudged (2x → manager escalation). */
  slaHours: number;
};

// Pipeline order (also display order). An account-opening form is e-signed only once every holder's identity
// is verified and the bank/risk profile are done; KRA/CKYC uploads use the signed form, so come last.
export const KYC_STEPS: KycStepDefinition[] = [
  { type: "PAN_VERIFICATION", label: "PAN verification", description: "PAN valid with ITD and name matches", perHolder: true, dependsOn: [], slaHours: 24 },
  { type: "ADDRESS_VERIFICATION", label: "Address (DigiLocker / Aadhaar)", description: "Address fetched from DigiLocker or Aadhaar offline XML", perHolder: true, dependsOn: [], slaHours: 48 },
  { type: "BANK_VERIFICATION", label: "Bank penny-drop", description: "Account exists and holder name matches", perHolder: false, dependsOn: [], slaHours: 24 },
  { type: "RISK_PROFILE", label: "Risk profile", description: "Risk-profiling questionnaire completed", perHolder: false, dependsOn: [], slaHours: 48 },
  {
    type: "IPV",
    label: "IPV / VIPV",
    description: "In-person or video verification",
    perHolder: true,
    dependsOn: [{ type: "PAN_VERIFICATION", scope: "same" }, { type: "ADDRESS_VERIFICATION", scope: "same" }],
    slaHours: 72,
  },
  {
    type: "ESIGN",
    label: "e-Sign",
    description: "Account opening form e-signed by all holders",
    perHolder: false,
    dependsOn: [
      { type: "PAN_VERIFICATION", scope: "all" },
      { type: "ADDRESS_VERIFICATION", scope: "all" },
      { type: "IPV", scope: "all" },
      { type: "BANK_VERIFICATION", scope: "primary" },
      { type: "RISK_PROFILE", scope: "primary" },
    ],
    slaHours: 48,
  },
  { type: "KRA", label: "KRA upload", description: "KYC record checked and uploaded to the KRA", perHolder: true, dependsOn: [{ type: "ESIGN", scope: "primary" }], slaHours: 72 },
  { type: "CKYC", label: "CKYC upload", description: "Record searched and uploaded to CKYC (CERSAI)", perHolder: true, dependsOn: [{ type: "ESIGN", scope: "primary" }], slaHours: 72 },
];

export const KYC_STEP_BY_TYPE = new Map(KYC_STEPS.map((s) => [s.type, s]));

export function holderKeyFor(holderId: string | null | undefined): string {
  return holderId ?? PRIMARY_HOLDER_KEY;
}

/** The steps to seed for one holder (null = First Holder). */
export function stepTypesForHolder(holderId: string | null): KycStepType[] {
  return KYC_STEPS.filter((s) => holderId === null || s.perHolder).map((s) => s.type);
}

export const DONE_STATUSES: KycStepStatus[] = ["VERIFIED", "SKIPPED"];

type StepLike = { type: KycStepType; holderKey: string; status: KycStepStatus };

/** Dependencies of `step` that aren't Verified/Skipped yet. Empty = the step may proceed. */
export function unmetDependencies<T extends StepLike>(step: StepLike, all: T[]): T[] {
  const definition = KYC_STEP_BY_TYPE.get(step.type)!;
  return definition.dependsOn.flatMap((dep) => {
    const candidates = all.filter(
      (s) =>
        s.type === dep.type &&
        (dep.scope === "all" || s.holderKey === (dep.scope === "primary" ? PRIMARY_HOLDER_KEY : step.holderKey)),
    );
    return candidates.filter((s) => !DONE_STATUSES.includes(s.status));
  });
}

/** Steps someone can act on right now: not done, and every dependency done. These are what drop-off
 * re-engagement watches — a step blocked behind another isn't "stuck", its blocker is. */
export function actionableSteps<T extends StepLike>(all: T[]): T[] {
  return all.filter((s) => !DONE_STATUSES.includes(s.status) && unmetDependencies(s, all).length === 0);
}

/** Step progress for one client: done / total, and whether KYC can be approved. */
export function pipelineProgress(all: StepLike[]): { done: number; total: number; complete: boolean } {
  const done = all.filter((s) => DONE_STATUSES.includes(s.status)).length;
  return { done, total: all.length, complete: all.length > 0 && done === all.length };
}
