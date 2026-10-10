"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Merge } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DuplicateHint } from "@/lib/clients/duplicate-hints";
import { askManagerToReviewAction } from "../duplicates/actions";

/**
 * Possible duplicates of this customer, for an RM. A duplicate that is also theirs can be merged from the Actions panel. One that
 * sits with another RM, or nobody, cannot be merged by an RM: the only action is "Ask a manager to review", and nothing about the
 * other customer is shown.
 */
export function DuplicateHintsCard({ hints }: { hints: DuplicateHint[] }) {
  if (hints.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading">
          <Merge className="size-4 text-primary" aria-hidden="true" /> Possible duplicates
        </CardTitle>
        <CardDescription>This customer may be the same person as another record.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {hints.map((h) => (h.kind === "yours" ? <Yours key={h.suggestionId} hint={h} /> : <Elsewhere key={h.suggestionId} hint={h} />))}
      </CardContent>
    </Card>
  );
}

function Yours({ hint }: { hint: Extract<DuplicateHint, { kind: "yours" }> }) {
  return (
    <p className="text-sm">
      <Link href={`/clients/${hint.partnerId}`} className="underline">{hint.name} ({hint.clientCode})</Link> looks like the same person and is also assigned to you.
      Use <span className="font-medium">Merge Duplicate</span> in the Actions panel to combine them.
    </p>
  );
}

function Elsewhere({ hint }: { hint: Extract<DuplicateHint, { kind: "elsewhere" }> }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "asked" | { error: string }>(hint.requested ? "asked" : "idle");
  const ask = () =>
    start(async () => {
      const res = await askManagerToReviewAction(hint.suggestionId);
      setState(res.ok ? "asked" : { error: res.error });
    });
  return (
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p>A possible duplicate of this customer is not assigned to you. Only a manager can merge records across teams.</p>
      {state === "asked" ? (
        <p role="status" className="shrink-0 text-muted-foreground">A manager has been asked to review this.</p>
      ) : (
        <Button size="sm" variant="outline" onClick={ask} disabled={pending} className="shrink-0">
          {pending ? "Asking…" : "Ask a manager to review"}
        </Button>
      )}
      {typeof state === "object" && <p role="alert" className="text-destructive">{state.error}</p>}
    </div>
  );
}
