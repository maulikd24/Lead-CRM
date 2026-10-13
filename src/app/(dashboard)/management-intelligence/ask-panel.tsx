"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { IntentResponse } from "@/lib/intelligence/ask-intents";
import { answerManagementQuestionAction } from "./actions";

const MIN_QUESTION = 5;

/**
 * Focus stays put while a question is pending: the button, the input and the chips use aria-disabled, not the disabled
 * attribute (which drops focus), and every click or submit is ignored while pending. The answer sits in a polite live region.
 */
export function AskPanel({ supported }: { supported: string[] }) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<IntentResponse | null>(null);
  const [pending, startTransition] = useTransition();
  const tooShort = question.trim().length < MIN_QUESTION;
  const inactive = pending || tooShort;

  function ask(text: string) {
    if (pending || text.trim().length < MIN_QUESTION) return;
    setQuestion(text);
    setResponse(null);
    startTransition(async () => setResponse(await answerManagementQuestionAction(text)));
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-base font-semibold leading-none">
          <HelpCircle className="size-4" aria-hidden="true" /> Ask the system
        </h2>
        <CardDescription>
          Six fixed questions, each a direct query over live data. No AI is used, so every answer shows the query it came from.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <label htmlFor="ask-question" className="sr-only">
            Ask a question about customers, funnel, team or quality
          </label>
          <Input
            id="ask-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Which KYC customers have not funded?"
            maxLength={500}
            aria-describedby="ask-hint"
          />
          <Button type="submit" aria-disabled={inactive} aria-describedby="ask-hint">
            {pending ? "Checking…" : "Ask"}
          </Button>
        </form>
        <p id="ask-hint" className="text-xs text-muted-foreground">
          {tooShort ? "Enter at least five characters to ask." : "Press Ask, or choose one of the questions below."}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {supported.map((example) => (
            <button
              key={example}
              type="button"
              aria-disabled={pending}
              onClick={() => {
                if (!pending) ask(example);
              }}
              className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted aria-disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col gap-3">
          {pending && <p className="text-sm text-muted-foreground">Checking your question…</p>}
          {!pending && response && !response.ok && (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
              <p>{response.message}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {response.supported.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {!pending && response?.ok && (
            <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">{response.question}</p>
              <p className="whitespace-pre-wrap text-sm">{response.answer}</p>
              {response.rows.length > 0 && (
                <ul className="divide-y text-sm">
                  {response.rows.map((row, i) => (
                    <li key={`${row.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="font-medium">{row.label}</span>
                      <span className="text-xs text-muted-foreground">{row.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Source: {response.source}. As of {format(new Date(response.asOf), "d MMM yyyy, HH:mm")}.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
