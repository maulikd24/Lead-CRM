"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { BoardCard, BoardColumn } from "@/lib/pipeline/board";
import {
  SubmitForKycForm,
  KycCompletionForm,
  FundingForm,
  DealerIntroForm,
  MarkOnboardingCompletedCard,
} from "../clients/[id]/stage-action-card";
import { getStageMoveContextAction, correctStageFromBoardAction, type StageMoveContext } from "./actions";

export type PendingMove = { card: BoardCard; from: BoardColumn; to: BoardColumn };

/**
 * Moving a card to the next stage opens that stage's own form — the one on the client's Onboarding / Funding tabs —
 * so the board can never skip a gate (verified documents, KYC approval, penny drop, minimum margin, dealer details).
 * The card only moves once the form succeeds; closing the dialog leaves it where it was.
 */
export function MoveDialog({ move, onClose, onDone }: { move: PendingMove | null; onClose: () => void; onDone: () => void }) {
  const [context, setContext] = useState<{ key: string; data: StageMoveContext } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = move ? `${move.card.id}:${move.to.stageId}` : null;

  useEffect(() => {
    if (!move || !key) return;
    let live = true;
    getStageMoveContextAction(move.card.id, move.to.stageId)
      .then((data) => live && setContext({ key, data }))
      .catch(() => live && setFailed(key));
    return () => {
      live = false;
    };
  }, [move, key]);

  const ctx = context?.key === key ? context.data : null;
  const loadFailed = failed === key;

  return (
    <Dialog open={!!move} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {move && (
          <>
            <DialogHeader>
              <DialogTitle>
                Move {move.card.name} to {move.to.name}
              </DialogTitle>
              <DialogDescription>The same step as on the client&apos;s page — the card moves once it&apos;s saved.</DialogDescription>
            </DialogHeader>
            {loadFailed ? (
              <p className="text-sm text-destructive">Couldn&apos;t load this client. Refresh the board and try again.</p>
            ) : !ctx ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <StageStep ctx={ctx} onDone={onDone} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StageStep({ ctx, onDone }: { ctx: StageMoveContext; onDone: () => void }) {
  const clientId = ctx.client.id;
  const openClient = (tab: string, text: string) => (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button size="sm" variant="outline" render={<Link href={`/clients/${clientId}?tab=${tab}`} />}>
        Open client
      </Button>
    </div>
  );

  switch (ctx.target.name) {
    case "Submitted for KYC":
      if (!ctx.contacted) return openClient("onboarding", "Record the first contact with this client before submitting for KYC.");
      if (!ctx.startedDocs) return openClient("onboarding", "Start document collection on the client's page before submitting for KYC.");
      return <SubmitForKycForm clientId={clientId} documents={ctx.documents} canOverride={ctx.canOverride} onDone={onDone} />;
    case "KYC completed":
      return <KycCompletionForm clientId={clientId} kycRecord={ctx.kycRecord} canApprove={ctx.canApproveKyc} pendingKycSteps={ctx.pendingKycSteps} onDone={onDone} />;
    case "Pushed for funds":
      return <FundingForm clientId={clientId} fundingRecord={ctx.fundingRecord} onDone={onDone} />;
    case "Introduction with Dealer":
      return <DealerIntroForm clientId={clientId} dealerIntroduction={ctx.dealerIntroduction} dealerUsers={ctx.dealerUsers} onDone={onDone} />;
    case "Onboarding Completed":
      if (!ctx.dealerIntroduction?.dealerName) return openClient("funding", "Record the dealer introduction before completing onboarding.");
      return <MarkOnboardingCompletedCard clientId={clientId} clientStatus={ctx.client.status} dealerName={ctx.dealerIntroduction.dealerName} onDone={onDone} />;
    default:
      return openClient("onboarding", "This stage is moved from the client's page.");
  }
}

/** Skipping a stage or going back: a stage correction with a reason. Admins apply it; a Manager's goes for approval. */
export function CorrectStageDialog({ move, role, onClose, onDone }: { move: PendingMove | null; role: string; onClose: () => void; onDone: () => void }) {
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    if (!move) return;
    setPending(true);
    try {
      const { pendingApproval } = await correctStageFromBoardAction(move.card.id, move.to.stageId, String(formData.get("reason") ?? ""));
      toast.success(pendingApproval ? "Stage correction sent for approval" : `Moved ${move.card.name} to ${move.to.name}`);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't correct the stage");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={!!move} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {move && (
          <form action={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                Correct {move.card.name}&apos;s stage
              </DialogTitle>
              <DialogDescription>
                {move.from.name} → {move.to.name}.{" "}
                {move.to.sequence > move.from.sequence ? "This skips the steps in between, so their checks don't run." : "This moves the client back."}{" "}
                {role === "MANAGER" ? "It goes to an Admin for approval." : "It's recorded in the audit log."}
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="correct-reason">Reason</FieldLabel>
              <Textarea id="correct-reason" name="reason" rows={3} required />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : role === "MANAGER" ? "Send for approval" : "Correct stage"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
