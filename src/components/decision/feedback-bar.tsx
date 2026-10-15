"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { submitDecisionFeedbackAction } from "@/app/(dashboard)/decisions/actions";
import { DNR_LABEL, WRONG_LABEL } from "./labels";

type Mode = null | "snooze" | "not_now" | "wrong" | "dnr";

const SNOOZES = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
] as const;
const DNR_DAYS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
] as const;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Accept, Done, Snooze, Wrong, Not now, Do not recommend. Accept creates a task for the RM; none of these sends anything.
 * Every choice that needs a reason offers a short list (no free text: no customer wording is stored).
 */
export function FeedbackBar({ decisionId, isRecommendation, productTopic }: { decisionId: string; isRecommendation: boolean; productTopic: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(() => ymd(new Date(Date.now() + 14 * 86_400_000)));
  const [bounds] = useState(() => ({ min: ymd(new Date(Date.now() + 86_400_000)), max: ymd(new Date(Date.now() + 90 * 86_400_000)) }));
  const [dnrDays, setDnrDays] = useState<number>(180);
  const [message, setMessage] = useState<string | null>(null);
  const reasonId = useId();

  function send(body: Record<string, unknown>, done: string) {
    setMessage(null);
    start(async () => {
      const r = await submitDecisionFeedbackAction(decisionId, body);
      if (r.ok) {
        toast.success(done);
        setMode(null);
        setReason("");
        router.refresh();
      } else {
        setMessage(r.error);
      }
    });
  }

  const choose = (m: Mode) => {
    setMode(mode === m ? null : m);
    setReason("");
    setMessage(null);
  };

  return (
    <div className="flex flex-col gap-2" aria-busy={pending}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Feedback on this decision">
        {isRecommendation && (
          <>
            <Button size="sm" disabled={pending} onClick={() => send({ kind: "accept" }, "Accepted: a task was created")}>
              Accept
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => send({ kind: "done" }, "Marked done")}>
              Done
            </Button>
            <Button size="sm" variant="outline" aria-pressed={mode === "snooze"} disabled={pending} onClick={() => choose("snooze")}>
              Snooze
            </Button>
            <Button size="sm" variant="outline" aria-pressed={mode === "not_now"} disabled={pending} onClick={() => choose("not_now")}>
              Not now
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" aria-pressed={mode === "wrong"} disabled={pending} onClick={() => choose("wrong")}>
          Wrong recommendation
        </Button>
        {isRecommendation && productTopic && (
          <Button size="sm" variant="outline" aria-pressed={mode === "dnr"} disabled={pending} onClick={() => choose("dnr")}>
            Do not recommend this product
          </Button>
        )}
      </div>

      {mode === "snooze" && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Snooze for">
          <span className="text-xs text-muted-foreground">Snooze for</span>
          {SNOOZES.map((s) => (
            <Button key={s.days} size="xs" variant="secondary" disabled={pending} onClick={() => send({ kind: "snooze", days: s.days }, `Snoozed for ${s.label}`)}>
              {s.label}
            </Button>
          ))}
        </div>
      )}

      {mode === "not_now" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${reasonId}-date`}>
            Not before
            <input id={`${reasonId}-date`} type="date" value={until} min={bounds.min} max={bounds.max} onChange={(e) => setUntil(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground" />
          </label>
          <Button size="sm" variant="secondary" disabled={pending || !until} onClick={() => send({ kind: "not_now", until: new Date(`${until}T09:00:00+05:30`).toISOString() }, "Not now: it will come back after that date")}>
            Confirm
          </Button>
        </div>
      )}

      {(mode === "wrong" || mode === "dnr") && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs text-muted-foreground">{mode === "wrong" ? "What was wrong?" : "Why should this product not be recommended?"}</legend>
          {Object.entries(mode === "wrong" ? WRONG_LABEL : DNR_LABEL).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${reasonId}-reason`} value={key} checked={reason === key} onChange={() => setReason(key)} className="size-4 accent-[var(--primary)]" />
              {label}
            </label>
          ))}
          {mode === "dnr" && (
            <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              Keep this for
              <select value={dnrDays} onChange={(e) => setDnrDays(Number(e.target.value))} className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground">
                {DNR_DAYS.map((d) => (
                  <option key={d.days} value={d.days}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div>
            <Button size="sm" variant="secondary" disabled={pending || !reason} onClick={() => send(mode === "wrong" ? { kind: "wrong", reason } : { kind: "dnr", reason, days: dnrDays }, mode === "wrong" ? "Thanks: marked wrong" : "Noted: this product will not be recommended")}>
              Confirm
            </Button>
          </div>
        </fieldset>
      )}

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
