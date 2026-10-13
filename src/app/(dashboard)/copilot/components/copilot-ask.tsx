"use client";

import { useReducer, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Sparkles, Send, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { AnswerRow } from "@/lib/intelligence/ask-intents";
import type { CustomerRow } from "@/lib/intelligence/management";
import { copilotAskAction, type CopilotAskResponse } from "../actions";

const MIN_QUESTION = 5;

/**
 * The Co-pilot chat. The conversation lives in this component's state only: it is not stored, sent anywhere but the
 * Ask action, or written to the browser. Reloading the page clears it.
 */

export type ChatTurn = { key: string; role: "user"; text: string } | { key: string; role: "assistant"; response: CopilotAskResponse };
export type ChatState = { turns: ChatTurn[]; pendingId: number | null };
export type ChatEvent =
  | { type: "submit"; id: number; text: string }
  | { type: "answer"; id: number; response: CopilotAskResponse }
  | { type: "clear" };

export const INITIAL_CHAT: ChatState = { turns: [], pendingId: null };

/** Enter sends. Shift+Enter is a new line. Enter while an IME is composing text is left alone. */
export function isSendKey(e: { key: string; shiftKey: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing;
}

/**
 * Pure reducer. A submit is ignored while another question is pending or when the text is too short. An answer lands only if
 * it is for the pending question: a conversation cleared while a question was in flight drops that answer.
 */
export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "submit": {
      const text = event.text.trim();
      if (state.pendingId !== null || text.length < MIN_QUESTION) return state;
      return { turns: [...state.turns, { key: `q${event.id}`, role: "user", text }], pendingId: event.id };
    }
    case "answer": {
      if (state.pendingId !== event.id) return state;
      return { turns: [...state.turns, { key: `a${event.id}`, role: "assistant", response: event.response }], pendingId: null };
    }
    case "clear":
      return { turns: [], pendingId: null };
  }
}

const asOfLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, "d MMM yyyy, HH:mm");
};

/** Renders the conversation. Answers carry their source and as-of time under them, as the management Ask does. */
export function ChatTranscript({ turns, supported, pending, onSuggest }: { turns: ChatTurn[]; supported: string[]; pending: boolean; onSuggest: (question: string) => void }) {
  if (turns.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Ask a question about your customers, or choose one of these to start.</p>
        <SuggestionList questions={supported} pending={pending} onSuggest={onSuggest} />
      </div>
    );
  }
  return (
    <>
      {turns.map((turn) =>
        turn.role === "user" ? (
          <div key={turn.key} className="ml-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="sr-only">You asked: </span>
            {turn.text}
          </div>
        ) : (
          <AnswerBlock key={turn.key} response={turn.response} pending={pending} onSuggest={onSuggest} />
        )
      )}
    </>
  );
}

/** The live region: every new answer is announced politely. The transcript is the only thing inside it. */
export function ChatLog(props: { turns: ChatTurn[]; supported: string[]; pending: boolean; onSuggest: (question: string) => void }) {
  return (
    <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
      <ChatTranscript turns={props.turns} supported={props.supported} pending={props.pending} onSuggest={props.onSuggest} />
    </div>
  );
}

function AnswerBlock({ response, pending, onSuggest }: { response: CopilotAskResponse; pending: boolean; onSuggest: (question: string) => void }) {
  if (!response.ok) {
    return (
      <div className="flex max-w-[95%] flex-col gap-2 rounded-lg border px-3 py-2 text-sm">
        <p className={response.reason === "error" ? "text-destructive" : undefined}>{response.message}</p>
        {response.supported.length > 0 && <SuggestionList questions={response.supported} pending={pending} onSuggest={onSuggest} />}
      </div>
    );
  }
  return (
    <div className="flex max-w-[95%] flex-col gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <p className="whitespace-pre-wrap">{response.answer}</p>
      {response.rows.length > 0 && (
        <ul className="divide-y text-sm">
          {response.rows.map((row: AnswerRow) => (
            <li key={row.label} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span>{row.label}</span>
              <span className="text-xs text-muted-foreground">{row.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {response.customers.length > 0 && (
        <ul className="divide-y text-sm">
          {response.customers.map((c: CustomerRow) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <div>
                <Link href={`/clients/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {c.name}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">
                  {c.code} · {c.rm ?? "Unassigned"} · {c.lifecycle}
                </span>
              </div>
              <span className="flex items-center gap-1.5 text-xs">
                <Badge variant={c.priority === "High" ? "destructive" : c.priority === "Medium" ? "secondary" : "outline"}>{c.priority}</Badge>
                {c.programme}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Source: {response.source}. As of <time dateTime={response.asOf}>{asOfLabel(response.asOf)}</time>.
      </p>
      {response.customers.length > 0 && <p className="text-xs text-muted-foreground">AI-generated from live data. Verify before acting.</p>}
    </div>
  );
}

function SuggestionList({ questions, pending, onSuggest }: { questions: string[]; pending: boolean; onSuggest: (question: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {questions.map((question) => (
        <li key={question}>
          <button
            type="button"
            aria-disabled={pending}
            onClick={() => {
              if (!pending) onSuggest(question);
            }}
            className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted aria-disabled:opacity-50"
          >
            {question}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CopilotAsk({ canAsk, supported }: { canAsk: boolean; supported: string[] }) {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_CHAT);
  const [draft, setDraft] = useState("");
  const counter = useRef(0);
  const inFlight = useRef<number | null>(null);
  const pending = state.pendingId !== null;
  const tooShort = draft.trim().length < MIN_QUESTION;
  const inactive = !canAsk || pending || tooShort;

  function send(text: string) {
    const q = text.trim();
    if (!canAsk || inFlight.current !== null || q.length < MIN_QUESTION) return;
    const id = ++counter.current;
    inFlight.current = id;
    dispatch({ type: "submit", id, text: q });
    setDraft("");
    copilotAskAction(q)
      .catch((): CopilotAskResponse => ({ ok: false, reason: "error", message: "Couldn't answer that right now.", supported: [] }))
      .then((response) => {
        if (inFlight.current === id) inFlight.current = null;
        dispatch({ type: "answer", id, response });
      });
  }

  function clear() {
    inFlight.current = null;
    dispatch({ type: "clear" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSendKey(e)) {
      e.preventDefault();
      send(draft);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-base font-semibold leading-none">
          <Sparkles className="size-4" aria-hidden="true" /> Ask the Co-pilot
        </h2>
        <CardDescription>
          {canAsk
            ? "Ask in plain English. Answers come from live data and cover only your own customers."
            : "Ask is for managers and admins. Your Co-pilot shows your own priorities above."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChatLog turns={state.turns} supported={supported} pending={pending} onSuggest={(q) => send(q)} />
        <p role="status" className="min-h-4 text-xs text-muted-foreground">
          {pending ? "Checking the answer…" : ""}
        </p>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <label htmlFor="copilot-ask-input" className="sr-only">
            Your question
          </label>
          <Textarea
            id="copilot-ask-input"
            rows={2}
            value={draft}
            maxLength={500}
            disabled={!canAsk}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. Which KYC customers have not funded?"
            aria-describedby="copilot-ask-hint"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id="copilot-ask-hint" className="text-xs text-muted-foreground">
              Enter sends. Shift + Enter adds a new line.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled={state.turns.length === 0 && !pending}
                onClick={() => {
                  if (state.turns.length > 0 || pending) clear();
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" /> Clear conversation
              </Button>
              <Button type="submit" size="sm" aria-disabled={inactive}>
                <Send className="size-3.5" aria-hidden="true" /> Send
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
