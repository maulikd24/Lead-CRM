"use client";

import { useState, useTransition } from "react";
import { Check, Copy, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { summarizePageAction, type SummaryResult } from "@/app/(dashboard)/ai-summary-actions";

type Props = {
  kind: "client" | "my_day" | "management" | "reports" | "quality_review" | "rm_individual" | "rm_overall";
  subjectId?: string;
  period?: Record<string, string>;
  /** Button label, e.g. "Summarize this client". */
  label?: string;
};

/** "Summarize" button + result for a page. Fetches only on click (nothing is sent to the AI until then). */
export function AiSummaryCard({ kind, subjectId, period, label = "Summarize this page" }: Props) {
  const [result, setResult] = useState<Extract<SummaryResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(force: boolean) {
    setError(null);
    startTransition(async () => {
      const response = await summarizePageAction({ kind, subjectId, period, force });
      if (response.ok) setResult(response);
      else setError(response.error);
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <Card size="sm" className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-primary" />
            AI summary
          </p>
          {result ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={copy} title="Copy summary">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => run(true)} disabled={pending} title="Regenerate">
                <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => run(false)} disabled={pending}>
              {pending ? "Summarizing…" : label}
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.summary}</p>
            <p className="text-[11px] text-muted-foreground">
              AI-generated from this page&apos;s data — verify before acting.{result.cached ? " Unchanged since last time." : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
