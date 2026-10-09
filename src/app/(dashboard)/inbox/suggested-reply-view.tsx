import { AlertTriangle, Check, RefreshCw, ShieldAlert, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssistState } from "@/lib/agents/reply-assist-service";

/** Fixed list, mirrors reason-category.ts: the chip shows why the draft was framed this way, never free text. */
export const REASON_LABELS: Record<string, string> = {
  kyc_pending: "KYC pending",
  kyc_stuck_in_documents: "KYC documents",
  signed_up_not_funded: "Not yet funded",
  funded_no_first_transaction: "No first transaction",
  other_onboarding: "Onboarding",
};

/** WhatsApp's own message limit, which is also the composer and send limit. */
export const WHATSAPP_MAX_CHARS = 4096;

export type SuggestedReplyViewProps = {
  /** True while a customer message is waiting for an answer; hides the Suggest button otherwise. */
  canSuggest?: boolean;
  state: AssistState | null;
  generating: boolean;
  /** The id of the suggestion currently copied into the composer. */
  usedId: string | null;
  onSuggest: () => void;
  onUse: (id: string, body: string) => void;
  onRegenerate: () => void;
  onDismiss: (id: string) => void;
};

const SHELL = "wa-assist-panel rounded-lg border border-border bg-muted/40 p-3 text-sm";

/** Pure presentation: every state of the suggested-reply panel. Animations are CSS-only and switch off under prefers-reduced-motion (globals.css). */
export function SuggestedReplyView({ canSuggest = true, state, generating, usedId, onSuggest, onUse, onRegenerate, onDismiss }: SuggestedReplyViewProps) {
  if (!state || !state.enabled) return null;
  const view = state.view;

  if (generating) {
    return (
      <div className={SHELL} role="status" data-state="generating">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" aria-hidden /> Drafting a reply for you to review…
        </div>
        <div className="mt-2 space-y-1.5" aria-hidden>
          <div className="wa-assist-shimmer h-3 w-11/12 rounded bg-muted" />
          <div className="wa-assist-shimmer h-3 w-8/12 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (view.kind === "needs_human") {
    return (
      <div className={cn(SHELL, "border-destructive/50 bg-destructive/10")} role="alert" data-state="needs-human">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-semibold text-foreground">Needs a person, not a draft</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              No reply was drafted{view.detail ? ` (${view.detail})` : ""}. Please answer this one personally.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (view.kind === "blocked") {
    return (
      <div className={SHELL} data-state="blocked">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold text-foreground">Could not draft safely</p>
            <p className="mt-0.5 text-xs text-muted-foreground">The draft failed a compliance check and was discarded. Write this reply yourself, or try again.</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onRegenerate}>
            <RefreshCw className="size-3.5" /> Try again
          </Button>
        </div>
      </div>
    );
  }

  if (view.kind === "draft") {
    const used = usedId === view.id;
    return (
      <div className={SHELL} data-state="draft">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          <span className="text-xs font-semibold">Suggested reply</span>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{REASON_LABELS[view.reason] ?? "Onboarding"}</Badge>
          {used && <Badge className="h-4 px-1.5 text-[10px]">In composer</Badge>}
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{view.body.length}/{WHATSAPP_MAX_CHARS} characters</span>
        </div>
        <p className="mt-2 break-words whitespace-pre-wrap text-foreground">{view.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => onUse(view.id, view.body)} disabled={used}>
            <Check className="size-3.5" /> {used ? "Edit below, then Send" : "Use"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onRegenerate}>
            <RefreshCw className="size-3.5" /> Regenerate
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onDismiss(view.id)}>
            <X className="size-3.5" /> Dismiss
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">AI draft. Nothing is sent until you press Send.</span>
        </div>
      </div>
    );
  }

  // none: nothing waiting, or waiting but not drafted yet.
  if (!canSuggest) return state.message ? <p className="text-xs text-muted-foreground" role="status" data-state="none">{state.message}</p> : null;
  return (
    <div className="flex items-center gap-2" data-state="none">
      <Button type="button" size="sm" variant="outline" onClick={onSuggest}>
        <Sparkles className="size-3.5" /> Suggest a reply
      </Button>
      {state.message && <span className="text-xs text-muted-foreground" role="status">{state.message}</span>}
    </div>
  );
}
