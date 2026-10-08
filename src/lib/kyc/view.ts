import type { KycStepStatus, KycStepType } from "@/generated/prisma/client";
import { DONE_STATUSES, KYC_STEP_BY_TYPE, PRIMARY_HOLDER_KEY, pipelineProgress, unmetDependencies } from "./steps";
import type { KycProvider } from "./providers";
import type { loadKycSteps } from "./pipeline";

export type KycStepView = {
  id: string;
  type: KycStepType;
  label: string;
  description: string;
  status: KycStepStatus;
  provider: string | null;
  attempts: number;
  failureReason: string | null;
  hoursInStatus: number;
  slaHours: number;
  /** Labels of the steps this one is waiting on; empty = can proceed. */
  waitingOn: string[];
  /** Actionable and past its SLA — what drop-off re-engagement is chasing. */
  stuck: boolean;
  canRunCheck: boolean;
  decidedByName: string | null;
  decidedAtIso: string | null;
};

export type KycPipelineView = {
  holders: { key: string; label: string; steps: KycStepView[] }[];
  done: number;
  total: number;
  complete: boolean;
  providerLabel: string | null;
};

/** Plain, serializable rows for the client page — every rule (dependencies, SLA, provider support) is evaluated
 * here on the server so the card only renders. */
export function buildKycPipelineView(
  steps: Awaited<ReturnType<typeof loadKycSteps>>,
  options: { now?: Date; provider: KycProvider | null; userNames: Map<string, string> },
): KycPipelineView {
  const now = options.now ?? new Date();
  const holders = new Map<string, { key: string; label: string; steps: KycStepView[] }>();

  for (const step of steps) {
    const definition = KYC_STEP_BY_TYPE.get(step.type)!;
    // Name the holder when the blocker is someone else's step (e.g. e-Sign waiting on a joint holder's address).
    const waitingOn = [
      ...new Set(unmetDependencies(step, steps).map((d) => `${KYC_STEP_BY_TYPE.get(d.type)!.label}${d.holderKey !== step.holderKey ? ` (${d.holder?.name ?? "First Holder"})` : ""}`)),
    ];
    const done = DONE_STATUSES.includes(step.status);
    const hoursInStatus = (now.getTime() - step.statusChangedAt.getTime()) / 3_600_000;
    const view: KycStepView = {
      id: step.id,
      type: step.type,
      label: definition.label,
      description: definition.description,
      status: step.status,
      provider: step.provider,
      attempts: step.attempts,
      failureReason: step.failureReason,
      hoursInStatus,
      slaHours: definition.slaHours,
      waitingOn,
      stuck: !done && waitingOn.length === 0 && hoursInStatus >= definition.slaHours,
      canRunCheck: !done && waitingOn.length === 0 && !!options.provider?.supports(step.type),
      decidedByName: step.decidedById ? (options.userNames.get(step.decidedById) ?? "Unknown user") : null,
      decidedAtIso: step.decidedAt?.toISOString() ?? null,
    };
    const label = step.holderKey === PRIMARY_HOLDER_KEY ? "First Holder" : `${step.holder?.name ?? "Joint holder"} (${(step.holder?.position ?? "").toLowerCase()} holder)`;
    if (!holders.has(step.holderKey)) holders.set(step.holderKey, { key: step.holderKey, label, steps: [] });
    holders.get(step.holderKey)!.steps.push(view);
  }

  return { holders: [...holders.values()], ...pipelineProgress(steps), providerLabel: options.provider?.label ?? null };
}
