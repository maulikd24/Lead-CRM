"use client";

import { useState, useTransition } from "react";
import { CircleSlash, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { createTaskAction } from "@/app/(dashboard)/tasks/actions";
import { dueFromTiming } from "@/lib/c360/status-line";
import type { IntelligenceView } from "@/lib/intelligence/view";

/**
 * The first screen's one focal point and its only accent-filled card: the next best action, why it is suggested, and one button.
 * "Create task" makes a follow-up task for the customer's RM (an ordinary task, audited like any other); nothing is sent to the customer.
 */
export function NextBestActionHero({ clientId, assigneeId, nba }: { clientId: string; assigneeId: string; nba: NonNullable<IntelligenceView["nba"]> }) {
  const [pending, start] = useTransition();
  const [created, setCreated] = useState(false);

  function create() {
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("clientId", clientId);
        fd.set("title", nba.topic ? `${nba.action}: ${nba.topic}` : nba.action);
        fd.set("dueAt", dueFromTiming(nba.timing, new Date()).toISOString());
        fd.set("assignedToId", assigneeId);
        fd.set("category", "FOLLOW_UP");
        fd.set("source", "next-best-action");
        await createTaskAction(fd);
        setCreated(true);
        toast.success("Task created", { description: nba.action });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not create the task");
      }
    });
  }

  return (
    <section aria-labelledby="c360-nba-title" className="c360-rise rounded-2xl bg-primary p-5 text-primary-foreground sm:p-6">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] opacity-80">
        <Sparkles aria-hidden className="size-3.5" /> Next best action
      </p>
      <h2 id="c360-nba-title" className="mt-2 font-heading text-xl font-semibold tracking-tight sm:text-2xl">
        {nba.action}
        {nba.topic ? <span className="font-normal opacity-80">: {nba.topic}</span> : null}
      </h2>
      <p className="mt-3 text-sm leading-relaxed">
        <span className="font-semibold">Why: </span>
        {nba.reason}
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm opacity-80">
        <Clock aria-hidden className="size-3.5" /> {nba.timing} · {nba.programme} · owner {nba.owner}
      </p>
      {nba.doNotDiscuss.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-sm">
          <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">Do not discuss: </span>
            {nba.doNotDiscuss.join(", ")}
          </span>
        </p>
      )}
      <div className="mt-5">
        <button
          type="button"
          onClick={create}
          disabled={pending || created}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary-foreground px-5 text-sm font-semibold text-[var(--primary)] outline-hidden transition-colors hover:bg-primary-foreground/85 focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:opacity-70"
        >
          {created ? "Task created" : pending ? "Creating…" : "Create task"}
        </button>
      </div>
    </section>
  );
}
