"use client";

import { useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { createSuggestionTaskAction, dismissSuggestionAction, requestSuggestionDraftAction, type ActionResult } from "@/app/(dashboard)/clients/[id]/360/outcomes-actions";
import { STATIC_COPY } from "@/lib/outcomes/copy";
import type { SuggestionModel } from "@/lib/outcomes/view-model";
import { cn } from "@/lib/utils";

const SEVERITY_VARIANT = { high: "warning", medium: "secondary", low: "outline" } as const;
const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/** Rule-based suggestions. Each one lists exactly what it looked at, can be turned into a task, can ask for a DRAFT message, and can be dismissed. */
export function SuggestionsList({ clientId, suggestions }: { clientId: string; suggestions: SuggestionModel[] }) {
  return (
    <section aria-labelledby="suggestions-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="suggestions-heading" className="font-heading text-lg font-semibold">{STATIC_COPY.suggestionsTitle}</h2>
        <p className="text-xs text-muted-foreground">{STATIC_COPY.rulesNote} {STATIC_COPY.tasksOnly}</p>
      </div>
      {suggestions.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" />
            {STATIC_COPY.suggestionsEmpty}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {suggestions.map((s, i) => (
            <li key={`${s.ruleKey}:${s.fingerprint}`}>
              <SuggestionCard clientId={clientId} s={s} index={i} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SuggestionCard({ clientId, s, index }: { clientId: string; s: SuggestionModel; index: number }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error);
    });
  return (
    <Card size="sm" className={cn(motion.enter)} style={{ ["--i" as string]: index }}>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <CardTitle className="text-sm">{s.title}</CardTitle>
        <Badge variant={SEVERITY_VARIANT[s.severity]}>{SEVERITY_LABEL[s.severity]}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{s.detail}</p>
        <details className="text-sm">
          <summary className="cursor-pointer rounded-sm text-xs font-medium text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Why am I seeing this?</summary>
          <dl className="mt-2 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
            {s.why.map((w) => (
              <div key={w.label} className="contents">
                <dt className="text-muted-foreground">{w.label}</dt>
                <dd className="font-medium">{w.value}</dd>
              </div>
            ))}
          </dl>
        </details>
        {s.canAct && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => run(() => createSuggestionTaskAction(clientId, s.ruleKey, s.fingerprint))} disabled={pending}>Create task</Button>
            {s.canDraft && (
              <Button size="sm" variant="outline" onClick={() => run(() => requestSuggestionDraftAction(clientId, s.ruleKey, s.fingerprint))} disabled={pending}>Draft a message</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => run(() => dismissSuggestionAction(clientId, s.ruleKey, s.fingerprint))} disabled={pending}>Dismiss</Button>
          </div>
        )}
        {s.canDraft && <p className="text-xs text-muted-foreground">{STATIC_COPY.draftNote}</p>}
      </CardContent>
    </Card>
  );
}
