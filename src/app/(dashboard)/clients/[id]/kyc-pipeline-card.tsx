"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatStageAge } from "@/lib/utils/format";
import type { KycPipelineView, KycStepView } from "@/lib/kyc/view";
import { decideKycStepAction, runKycCheckAction, startKycStepAction } from "../kyc-step-actions";

const STATUS: Record<KycStepView["status"], { label: string; variant: "outline" | "secondary" | "success" | "destructive" | "warning" }> = {
  NOT_STARTED: { label: "Not started", variant: "outline" },
  IN_PROGRESS: { label: "In progress", variant: "secondary" },
  VERIFIED: { label: "Verified", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  SKIPPED: { label: "Skipped", variant: "outline" },
};

type ReasonAction = "FAILED" | "SKIPPED" | "IN_PROGRESS";
const REASON_PROMPT: Record<ReasonAction, { title: string; confirm: string; done: string }> = {
  FAILED: { title: "Why did this step fail?", confirm: "Mark failed", done: "marked failed" },
  SKIPPED: { title: "Why is this step not needed?", confirm: "Skip step", done: "skipped" },
  IN_PROGRESS: { title: "Why reopen this step?", confirm: "Reopen", done: "reopened" },
};

/** KYC pipeline v2 on the Onboarding tab. All rules are evaluated server-side (lib/kyc/view.ts) and re-checked by
 * the actions; this only renders. RMs start steps and run checks; Admins/Managers verify, fail, skip, reopen. */
export function KycPipelineCard({ pipeline, canDecide }: { pipeline: KycPipelineView; canDecide: boolean }) {
  return (
    <div className="flex flex-col gap-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">KYC pipeline</p>
        <span className="text-xs text-muted-foreground">
          {pipeline.done} of {pipeline.total} steps done
          {pipeline.providerLabel ? ` · Automated checks: ${pipeline.providerLabel}` : " · Manual verification"}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={pipeline.total} aria-valuenow={pipeline.done}>
        <div className="h-full bg-primary transition-all" style={{ width: `${pipeline.total ? (pipeline.done / pipeline.total) * 100 : 0}%` }} />
      </div>
      {pipeline.holders.map((holder) => (
        <div key={holder.key} className="flex flex-col gap-2">
          {pipeline.holders.length > 1 && <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{holder.label}</p>}
          <ul className="flex flex-col divide-y rounded-md border">
            {holder.steps.map((step) => (
              <KycStepRow key={step.id} step={step} canDecide={canDecide} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function KycStepRow({ step, canDecide }: { step: KycStepView; canDecide: boolean }) {
  const [pending, startTransition] = useTransition();
  const [reasonFor, setReasonFor] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const done = step.status === "VERIFIED" || step.status === "SKIPPED";
  const blocked = step.waitingOn.length > 0;
  const status = STATUS[step.status];

  function run(label: string, action: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        const result = await action();
        const outcome = result as { status?: string; failureReason?: string | null } | undefined;
        if (outcome?.status === "FAILED") toast.error(`${step.label} failed: ${outcome.failureReason ?? "no reason given"}`);
        else toast.success(outcome?.status === "IN_PROGRESS" ? `${step.label}: waiting on the client` : label);
        setReasonFor(null);
        setReason("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  const meta = [
    step.attempts > 1 ? `${step.attempts} attempts` : null,
    !done && !blocked ? `${formatStageAge(step.hoursInStatus)} in this status` : null,
    // An automated result was decided by the provider; the user only ran the check.
    done && step.decidedByName
      ? `${step.provider && step.provider !== "manual" ? `Checked by ${step.provider} · run by` : step.status === "SKIPPED" ? "Skipped by" : "Verified by"} ${step.decidedByName}${step.decidedAtIso ? ` · ${formatDateTime(new Date(step.decidedAtIso))}` : ""}`
      : step.provider && step.provider !== "manual"
        ? `via ${step.provider}`
        : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{step.label}</span>
            <Badge variant={status.variant}>{status.label}</Badge>
            {step.stuck && <Badge variant="warning">Stuck · SLA {step.slaHours}h</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{step.description}</p>
          {blocked && !done && <p className="text-xs text-muted-foreground">Waiting on: {step.waitingOn.join(", ")}</p>}
          {step.status === "FAILED" && step.failureReason && <p className="text-xs text-destructive">Reason: {step.failureReason}</p>}
          {meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!done && !blocked && step.status !== "IN_PROGRESS" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(step.status === "FAILED" ? "Retrying" : "Step started", () => startKycStepAction(step.id))}>
              {step.status === "FAILED" ? "Retry" : "Start"}
            </Button>
          )}
          {step.canRunCheck && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`${step.label} verified`, () => runKycCheckAction(step.id))}>
              {step.status === "IN_PROGRESS" && step.provider !== "manual" ? "Check status" : "Run check"}
            </Button>
          )}
          {canDecide && !done && !blocked && step.status !== "FAILED" && (
            <Button size="sm" disabled={pending} onClick={() => run(`${step.label} verified`, () => decideKycStepAction(step.id, { to: "VERIFIED" }))}>
              Verify
            </Button>
          )}
          {canDecide && !done && !blocked && step.status !== "FAILED" && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setReasonFor("FAILED")}>
              Fail
            </Button>
          )}
          {canDecide && !done && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setReasonFor("SKIPPED")}>
              Skip
            </Button>
          )}
          {canDecide && done && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setReasonFor("IN_PROGRESS")}>
              Reopen
            </Button>
          )}
        </div>
      </div>
      {reasonFor && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const to = reasonFor;
            run(`${step.label} ${REASON_PROMPT[to].done}`, () => decideKycStepAction(step.id, { to, reason }));
          }}
        >
          <Input autoFocus required aria-label={REASON_PROMPT[reasonFor].title} placeholder={REASON_PROMPT[reasonFor].title} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-1.5">
            <Button size="sm" type="submit" variant={reasonFor === "FAILED" ? "destructive" : "default"} disabled={pending || !reason.trim()}>
              {REASON_PROMPT[reasonFor].confirm}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
