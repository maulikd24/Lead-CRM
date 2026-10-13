"use client";

import { useState } from "react";
import { Check, ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { draftWithAiAction, handOverToRmAction, requestDraftApprovalAction } from "./draft-actions";

/** What the panel shows. Every state is a value here, so the view can be rendered and tested on its own. */
export type AiDraftPhase =
  | { kind: "idle" }
  | { kind: "drafting" }
  | { kind: "draft"; source: "model" | "template"; edited: boolean }
  | { kind: "refused"; message: string; canHandOver: boolean }
  | { kind: "requesting" }
  | { kind: "requested" }
  | { kind: "handing_over" }
  | { kind: "handed_over" }
  | { kind: "already_open" };

export type AiDraftViewProps = {
  phase: AiDraftPhase;
  text: string;
  onText: (text: string) => void;
  onDraft: () => void;
  onSendForApproval: () => void;
  onHandOver: () => void;
  onDiscard: () => void;
};

const SHELL = "wa-ai-draft rounded-lg border border-border bg-muted/40 p-3 text-sm";
const MAX = 4096;

/** Pure presentation of the "Draft with AI" panel. Nothing in it sends a message: "Send for approval" only stores the text for a decision. */
export function AiDraftView({ phase, text, onText, onDraft, onSendForApproval, onHandOver, onDiscard }: AiDraftViewProps) {
  if (phase.kind === "idle") {
    return (
      <div className="flex items-center gap-2" data-state="idle">
        <Button type="button" size="sm" variant="outline" onClick={onDraft}>
          <Sparkles className="size-3.5" /> Draft with AI
        </Button>
      </div>
    );
  }

  if (phase.kind === "drafting") {
    return (
      <p className="text-xs text-muted-foreground" role="status" data-state="drafting">
        <Sparkles className="mr-1 inline size-3.5 text-primary" aria-hidden /> Drafting a message for you to review…
      </p>
    );
  }

  if (phase.kind === "refused") {
    return (
      <div className={cn(SHELL, "border-warning/50 bg-warning/10")} role="alert" data-state="refused">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold text-foreground">No draft was made</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{phase.message}</p>
          </div>
          {phase.canHandOver && (
            <Button type="button" size="sm" variant="outline" onClick={onHandOver} className="min-h-9">
              Hand over to RM
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === "handing_over" || phase.kind === "requesting") {
    return (
      <p className="text-xs text-muted-foreground" role="status" data-state={phase.kind}>
        {phase.kind === "handing_over" ? "Handing over to your RM…" : "Sending for approval…"}
      </p>
    );
  }

  if (phase.kind === "handed_over" || phase.kind === "already_open") {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-foreground" role="status" data-state={phase.kind}>
        {phase.kind === "handed_over" ? "Handed over to your RM. A task has been created for them." : "An RM handover is already open for this customer."}
      </p>
    );
  }

  if (phase.kind === "requested") {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-foreground" role="status" data-state="requested">
        Sent for approval. Nothing has gone to the customer. A Manager or Admin must approve it first.
      </p>
    );
  }

  // draft: the editable box and the one action that stores it for a decision.
  const over = text.length > MAX;
  const empty = text.trim().length === 0;
  return (
    <div className={cn(SHELL, "p-0")} data-state="draft">
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        <span className="text-xs font-semibold">AI draft</span>
        {phase.source === "template" && <Badge variant="outline" className="h-5 px-1.5 text-xs">Standard wording</Badge>}
        {phase.edited && <Badge variant="secondary" className="h-5 px-1.5 text-xs">Edited</Badge>}
      </div>
      <label className="sr-only" htmlFor="ai-draft-text">AI draft, editable</label>
      <Textarea id="ai-draft-text" value={text} onChange={(e) => onText(e.target.value)} rows={3} className="mt-2 min-h-0 resize-none border-0 bg-transparent px-3 text-sm" />
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <span className={cn("text-xs tabular-nums", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {text.length}/{MAX} characters
        </span>
        <span className="text-xs text-muted-foreground">Not sent. It goes for approval first.</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard} className="min-h-9">
            <X className="size-3.5" /> Discard
          </Button>
          <Button type="button" size="sm" onClick={onSendForApproval} disabled={over || empty} className="min-h-9">
            <Check className="size-3.5" /> Send for approval
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Stateful wrapper. Mount with key={clientId}: the draft belongs to one conversation. Calls only the three server actions above. */
export function AiDraftPanel({ clientId }: { clientId: string }) {
  const [phase, setPhase] = useState<AiDraftPhase>({ kind: "idle" });
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [source, setSource] = useState<"model" | "template">("template");
  const [refusalReason, setRefusalReason] = useState("");

  async function draft() {
    setPhase({ kind: "drafting" });
    try {
      const result = await draftWithAiAction(clientId);
      if (result.status === "draft") {
        setText(result.body);
        setOriginal(result.body);
        setSource(result.source);
        setPhase({ kind: "draft", source: result.source, edited: false });
      } else {
        setRefusalReason(result.message);
        setPhase({ kind: "refused", message: result.message, canHandOver: result.canHandOver });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not draft a message right now.");
      setPhase({ kind: "idle" });
    }
  }

  async function sendForApproval() {
    setPhase({ kind: "requesting" });
    try {
      const result = await requestDraftApprovalAction(clientId, text, text !== original, source);
      if (result.status === "requested") {
        setPhase({ kind: "requested" });
      } else {
        setPhase({ kind: "refused", message: result.message, canHandOver: result.canHandOver });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send for approval.");
      setPhase({ kind: "draft", source, edited: text !== original });
    }
  }

  async function handOver() {
    setPhase({ kind: "handing_over" });
    try {
      const result = await handOverToRmAction(clientId, refusalReason);
      if (result.status === "handed_over") setPhase({ kind: "handed_over" });
      else if (result.status === "already_open") setPhase({ kind: "already_open" });
      else setPhase({ kind: "refused", message: result.message, canHandOver: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not hand over.");
      setPhase({ kind: "refused", message: refusalReason, canHandOver: true });
    }
  }

  return (
    <AiDraftView
      phase={phase}
      text={text}
      onText={setText}
      onDraft={() => void draft()}
      onSendForApproval={() => void sendForApproval()}
      onHandOver={() => void handOver()}
      onDiscard={() => {
        setText("");
        setPhase({ kind: "idle" });
      }}
    />
  );
}
