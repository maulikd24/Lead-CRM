"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { IntentResponse } from "@/lib/intelligence/ask-intents";
import { answerManagementQuestionAction } from "./actions";

export function AskPanel({ supported }: { supported: string[] }) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<IntentResponse | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(text: string) {
    setQuestion(text);
    setResponse(null);
    startTransition(async () => setResponse(await answerManagementQuestionAction(text)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="size-4" /> Ask the system
        </CardTitle>
        <CardDescription>
          Six fixed questions, each a direct query over live data. No AI is used, so every answer shows the query it came from.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim().length >= 5) ask(question);
          }}
        >
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Which KYC customers have not funded?" maxLength={500} />
          <Button type="submit" disabled={pending || question.trim().length < 5}>
            {pending ? "Checking…" : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {supported.map((example) => (
            <button key={example} type="button" disabled={pending} onClick={() => ask(example)} className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
              {example}
            </button>
          ))}
        </div>
        {response && !response.ok && (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <p>{response.message}</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {response.supported.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        )}
        {response?.ok && (
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
      </CardContent>
    </Card>
  );
}
