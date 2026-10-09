"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AssistState } from "@/lib/agents/reply-assist-service";
import { dismissSuggestionAction, getAssistAction, suggestReplyAction } from "./actions";
import { SuggestedReplyView } from "./suggested-reply-view";

/**
 * Mount with key={clientId}: state resets per conversation. Loads and drives the suggested-reply panel for one conversation. It never sends: Use copies the draft into the composer,
 * and the RM's own Send (with the suggestion id) is the approval. State is refetched when the customer's latest message changes.
 */
export function SuggestedReplyPanel({
  clientId,
  lastInboundId,
  unanswered,
  usedId,
  onUse,
  onDismissed,
  onRestoreFocus,
}: {
  clientId: string;
  lastInboundId: string | null;
  unanswered: boolean;
  usedId: string | null;
  onUse: (id: string, body: string) => void;
  onDismissed: (id: string) => void;
  /** Puts focus back in the composer after an action removes the button that had it. */
  onRestoreFocus: () => void;
}) {
  const [state, setState] = useState<AssistState | null>(null);
  const [generating, setGenerating] = useState(false);
  const request = useRef(0);
  const autoTried = useRef<string | null>(null);

  const run = useCallback(
    async (opts: { regenerate?: boolean; auto?: boolean }) => {
      const id = ++request.current;
      setGenerating(true);
      try {
        const next = await suggestReplyAction(clientId, opts);
        if (id === request.current) setState(next);
      } catch {
        if (id === request.current) toast.error("Could not draft a reply right now.");
      } finally {
        if (id === request.current) {
          setGenerating(false);
          onRestoreFocus();
        }
      }
    },
    [clientId, onRestoreFocus],
  );

  useEffect(() => {
    let cancelled = false;
    const id = ++request.current;
    getAssistAction(clientId)
      .then((next) => {
        if (cancelled || id !== request.current) return;
        setState(next);
        // WA_ASSIST_AUTO=1: draft once per customer message when the RM opens a conversation that is waiting for an answer.
        const key = `${clientId}:${lastInboundId}`;
        if (next.enabled && next.auto && unanswered && next.view.kind === "none" && autoTried.current !== key) {
          autoTried.current = key;
          void run({ auto: true });
        }
      })
      .catch((e) => console.error("wa_reply: could not load panel state", e instanceof Error ? e.name : "error"));
    return () => {
      cancelled = true;
    };
  }, [clientId, lastInboundId, unanswered, run]);

  return (
    <div aria-live="polite" aria-atomic="false">
    <SuggestedReplyView
      canSuggest={unanswered}
      state={state}
      generating={generating}
      usedId={usedId}
      onSuggest={() => void run({})}
      onUse={onUse}
      onRegenerate={() => void run({ regenerate: true })}
      onDismiss={(id) => {
        onDismissed(id);
        void dismissSuggestionAction(clientId, id)
          .then((next) => {
            setState(next);
            onRestoreFocus();
          })
          .catch(() => toast.error("Could not dismiss the suggestion."));
      }}
    />
    </div>
  );
}
