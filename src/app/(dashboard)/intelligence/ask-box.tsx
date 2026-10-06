"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { askSystemAction, type AskResponse } from "./actions";

const EXAMPLES = [
  "Which customers need attention today?",
  "Which HNI clients have high PMS acceptance?",
  "Which KYC customers have not funded?",
  "Which RMs have overdue follow-ups?",
  "What are the most common customer objections?",
  "Where are we losing customers in the journey?",
];

export function AskBox() {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(text: string) {
    setQuestion(text);
    setResponse(null);
    startTransition(async () => setResponse(await askSystemAction(text)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" /> Ask the system
        </CardTitle>
        <CardDescription>Ask in plain English. Answers come from live data and cover only your own customers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) ask(question);
          }}
        >
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Which KYC customers have not funded?" maxLength={500} />
          <Button type="submit" disabled={pending || question.trim().length < 5}>
            {pending ? "Thinking…" : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" disabled={pending} onClick={() => ask(example)} className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
              {example}
            </button>
          ))}
        </div>
        {response && !response.ok && <p className="text-sm text-destructive">{response.error}</p>}
        {response?.ok && (
          <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
            <p className="whitespace-pre-wrap text-sm">{response.answer}</p>
            {response.customers.length > 0 && (
              <ul className="divide-y text-sm">
                {response.customers.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <div>
                      <Link href={`/clients/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                        {c.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{c.code} · {c.rm ?? "Unassigned"} · {c.lifecycle}</span>
                    </div>
                    <span className="flex items-center gap-1.5 text-xs">
                      <Badge variant={c.priority === "High" ? "destructive" : c.priority === "Medium" ? "warning" : "outline"}>{c.priority}</Badge>
                      {c.programme}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">AI-generated from live data — verify before acting.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
