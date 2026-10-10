"use client";

import { useImperativeHandle, useRef, useState, useTransition, type Ref } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { Armed } from "@/lib/agents/review-keys";
import { approveAction, rejectAction } from "./actions";

const MAX_LEN = 1000;

export type Draft = {
  id: string;
  body: string;
  reason: string;
  programme: string | null;
  expiry: string;
  client: { name: string; clientCode: string };
};

type Result = { ok: boolean; error?: string };

/** What the review list can ask the open draft to do (the keyboard shortcuts go through these). */
export type ProposalCardHandle = { approve: () => void; reject: () => void; focusEditor: () => void; busy: () => boolean };

export function ProposalCard({
  draft,
  canAct,
  armed = null,
  onDecided,
  handle,
}: {
  draft: Draft;
  canAct: boolean;
  /** A shortcut has armed this action: the button asks for one more press. */
  armed?: Armed;
  /** Called once the server has accepted the decision, so the list can move on to the next draft. */
  onDecided?: (id: string, kind: "sent" | "rejected") => void;
  handle?: Ref<ProposalCardHandle>;
}) {
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editor = useRef<HTMLTextAreaElement>(null);

  const tooLong = body.length > MAX_LEN;
  const empty = body.trim().length === 0;

  const run = (fn: () => Promise<Result>, doneLabel: "sent" | "rejected") =>
    start(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          setError(null);
          setDone(doneLabel); // optimistic removal: the card disappears now, the server revalidation confirms it
          onDecided?.(draft.id, doneLabel);
        } else {
          setError(res.error ?? "Something went wrong");
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });

  const approve = () => {
    if (!canAct || pending || tooLong || empty) {
      if (canAct && (tooLong || empty)) setError(empty ? "The message is empty." : `The message is over ${MAX_LEN} characters.`);
      return;
    }
    run(() => approveAction(draft.id, body === draft.body ? undefined : body), "sent");
  };
  const reject = () => {
    if (!canAct || pending) return;
    run(() => rejectAction(draft.id), "rejected");
  };

  useImperativeHandle(handle, () => ({ approve, reject, focusEditor: () => editor.current?.focus(), busy: () => pending }));

  if (done) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          {draft.client.name}
          <span className="text-sm font-normal text-muted-foreground">{draft.client.clientCode}</span>
        </CardTitle>
        <CardDescription>
          {draft.programme ? `${draft.programme}: ` : ""}
          {draft.reason} · {draft.expiry}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit text-primary">AI draft — review before sending</Badge>
        {canAct ? (
          <>
            <Textarea
              ref={editor}
              aria-label={`Message to ${draft.client.name}`}
              className="min-h-24"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={pending}
              aria-invalid={tooLong}
              aria-describedby={`count-${draft.id}`}
              // No maxLength on purpose: it would silently truncate pasted text; the counter and disabled button handle the limit.
            />
            <p id={`count-${draft.id}`} aria-live={tooLong ? "polite" : "off"} className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
              {body.length} / {MAX_LEN}
            </p>
          </>
        ) : (
          <p className="whitespace-pre-wrap rounded-lg border border-input p-2.5 text-sm">{draft.body}</p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {canAct ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending || tooLong || empty} onClick={approve} aria-keyshortcuts="A" className={armed === "approve" ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : undefined}>
                {pending ? "Working…" : armed === "approve" ? "Press A again to send" : "Approve and send"}
                {!pending && armed !== "approve" && <kbd className="ml-1 rounded border border-primary-foreground/40 px-1 text-[10px] font-medium">A</kbd>}
              </Button>
              <Button variant="outline" disabled={pending} onClick={reject} aria-keyshortcuts="R" className={armed === "reject" ? "border-destructive text-destructive ring-2 ring-destructive/50" : undefined}>
                {armed === "reject" ? "Press R again to reject" : "Reject"}
                {armed !== "reject" && <kbd className="ml-1 rounded border border-border px-1 text-[10px] font-medium text-muted-foreground">R</kbd>}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {armed ? "Press the same key or Enter to confirm, Esc to cancel." : "Shortcuts: A approve, R reject, E edit, J and K next and previous. Ctrl or Cmd+Enter from the editor."}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">View only</p>
        )}
      </CardContent>
    </Card>
  );
}
