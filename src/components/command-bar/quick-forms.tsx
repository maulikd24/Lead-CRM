"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, PhoneCall, ListPlus } from "lucide-react";
import { toast } from "sonner";

import { createTaskAction } from "@/app/(dashboard)/tasks/actions";
import { recordRmContactAction } from "@/app/(dashboard)/clients/actions";
import { searchClientsForPalette, type PaletteClientResult } from "@/app/(dashboard)/command-search-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { CALL_OUTCOMES, DUE_CHOICES, dueDate, validateCall, validateTask, type DueChoice } from "./quick-actions-logic";

type Picked = { id: string; name: string; clientCode: string };

function ClientPicker({ picked, onPick }: { picked: Picked | null; onPick: (c: Picked | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PaletteClientResult[]>([]);
  useEffect(() => {
    if (picked || q.trim().length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      const found = await searchClientsForPalette(q);
      if (live) setResults(found);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, picked]);
  const shown = picked || q.trim().length < 2 ? [] : results;
  if (picked) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm">
        <span className="min-w-0 truncate"><span className="font-medium">{picked.name}</span> <span className="font-mono text-xs text-muted-foreground">{picked.clientCode}</span></span>
        <button type="button" onClick={() => onPick(null)} className="min-h-11 px-1 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Change</button>
      </div>
    );
  }
  return (
    <div>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client by name, code or mobile" aria-label="Client" className="h-11" />
      {shown.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border p-1" aria-label="Matching clients">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick({ id: c.id, name: c.name, clientCode: c.clientCode })} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.clientCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const field = "text-xs font-medium text-muted-foreground";

/**
 * The two quick actions the command bar morphs into. Each is a short form in the same floating panel: pick a client, fill in two
 * things, press Enter. They call the same server actions as the full screens (an ordinary task; a recorded contact), so the rules
 * and the audit trail are the same. Esc or the back arrow returns to search.
 */
export function QuickActionForm({ kind, userId, onBack, onDone }: { kind: "task" | "call"; userId: string; onBack: () => void; onDone: () => void }) {
  const [client, setClient] = useState<Picked | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<DueChoice>("tomorrow");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLFormElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = kind === "task" ? validateTask({ clientId: client?.id ?? "", title }) : validateCall({ clientId: client?.id ?? "", outcome, notes, nextAction });
    setError(problem);
    if (problem || !client) return;
    setPending(true);
    try {
      if (kind === "task") {
        const fd = new FormData();
        fd.set("clientId", client.id);
        fd.set("title", title.trim());
        fd.set("dueAt", dueDate(due, new Date()).toISOString());
        fd.set("assignedToId", userId);
        fd.set("category", "FOLLOW_UP");
        fd.set("source", "command-bar");
        await createTaskAction(fd);
        toast.success("Task added", { description: `${title.trim()}: ${client.name}` });
      } else {
        await recordRmContactAction(client.id, {
          contactMethod: "Phone",
          contactOutcome: outcome as (typeof CALL_OUTCOMES)[number],
          notes: notes.trim() || undefined,
          nextAction: nextAction.trim() || undefined,
          nextActionDate: nextAction.trim() ? dueDate("tomorrow", new Date()).toISOString() : undefined,
        });
        toast.success("Call logged", { description: `${outcome}: ${client.name}` });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setPending(false);
    }
  }

  const Icon = kind === "task" ? ListPlus : PhoneCall;
  const needsNext = outcome === "Call back requested" || outcome === "Interested";
  return (
    <form
      ref={root}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
      }}
      className="flex flex-col gap-3 p-4"
      aria-label={kind === "task" ? "Add a task" : "Log a call"}
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back to search" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <Icon aria-hidden className="size-4 text-[var(--primary-ink)]" />
        <h2 className="font-heading text-base font-semibold">{kind === "task" ? "Add a task" : "Log a call"}</h2>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={field}>Client</span>
        <ClientPicker picked={client} onPick={setClient} />
      </div>
      {kind === "task" ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className={field}>What needs doing</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call back about the SIP" className="h-11" maxLength={200} />
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className={field}>Due</legend>
            <div className="flex gap-2">
              {DUE_CHOICES.map((d) => (
                <label key={d.key} className={cn("flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring", "border-border")}>
                  <input type="radio" name="due" value={d.key} checked={due === d.key} onChange={() => setDue(d.key)} className="sr-only" />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className={field}>Outcome</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
              <option value="">Choose…</option>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={field}>Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was said" className="h-11" maxLength={500} />
          </label>
          {needsNext && (
            <label className="flex flex-col gap-1.5">
              <span className={field}>Next action (due tomorrow)</span>
              <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Send the account form" className="h-11" maxLength={200} />
            </label>
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="min-h-11 px-5">
          <Check className="size-4" /> {pending ? "Saving…" : kind === "task" ? "Add task" : "Log call"}
        </Button>
      </div>
    </form>
  );
}
