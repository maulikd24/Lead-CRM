"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { approveAction, rejectAction } from "./actions";

const MAX_LEN = 1000;

type Draft = {
  id: string;
  body: string;
  reason: string;
  programme: string | null;
  expiry: string;
  client: { name: string; clientCode: string };
};

type Result = { ok: boolean; error?: string };

export function ProposalCard({ draft, canAct }: { draft: Draft; canAct: boolean }) {
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<Result>, doneLabel: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          setError(null);
          setDone(doneLabel); // optimistic removal: the card disappears now, the server revalidation confirms it
        } else {
          setError(res.error ?? "Something went wrong");
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });

  if (done) return null;

  const tooLong = body.length > MAX_LEN;
  const empty = body.trim().length === 0;

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
          <div className="flex gap-2">
            <Button disabled={pending || tooLong || empty} onClick={() => run(() => approveAction(draft.id, body === draft.body ? undefined : body), "sent")}>
              {pending ? "Working…" : "Approve and send"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => run(() => rejectAction(draft.id), "rejected")}>
              Reject
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">View only</p>
        )}
      </CardContent>
    </Card>
  );
}
