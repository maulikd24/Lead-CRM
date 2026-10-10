"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { RailCard, StickyRail, WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs, useUrlTab } from "@/components/workspace";
import type { ComparisonResult, QueueItem } from "@/lib/identity/merge-review/load";
import { canAskManager, reviewKeyAction, skipTarget } from "@/lib/identity/merge-review/review-model";
import type { SensitiveField } from "@/lib/identity/merge-review/view-model";
import { askManagerToReviewAction, dismissSuggestionAction, getComparisonAction, mergeSuggestionAction, revealFieldAction } from "./actions";
import { ComparisonTable, ConfidenceBar, DecisionBar, PlanPreview, QueueRow, RestrictedPair, SurvivorChooser } from "./review-parts";
import styles from "./duplicates.module.css";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

const TABS = [
  { key: "compare", label: "Compare" },
  { key: "plan", label: "What merging does" },
] as const;
const TAB_KEYS = TABS.map((t) => t.key);
const kbd = "rounded border px-1 font-mono";

export function ReviewQueue({ items: initial, total, viewerRole }: { items: QueueItem[]; total: number; viewerRole: string }) {
  const { tab, select: selectTab, hrefFor } = useUrlTab(TAB_KEYS, "compare");
  const [asked, setAsked] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState(initial);
  const [decided, setDecided] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [details, setDetails] = useState<Record<string, ComparisonResult>>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "merge" | "dismiss">(null);
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const requested = useRef(new Set<string>());

  const remaining = Math.max(0, total - decided);
  const index = items.findIndex((i) => i.id === selectedId);
  const detail = selectedId ? details[selectedId] : undefined;
  const data = detail?.ok ? detail.data : null;
  const survivorId = data ? (choice[data.suggestionId] ?? data.defaultSurvivorId) : null;
  const restricted = !!data?.restricted;
  const plan = data && survivorId ? (data.plans[survivorId] ?? null) : null;
  const survivor = data && survivorId ? (survivorId === data.sides.a.id ? data.sides.a : data.sides.b) : null;
  const duplicate = data && survivorId ? (survivorId === data.sides.a.id ? data.sides.b : data.sides.a) : null;
  const ownSide = data && restricted ? (data.sides.a.id === data.defaultSurvivorId ? data.sides.a : data.sides.b) : null;

  const load = useCallback((id: string) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    getComparisonAction(id)
      .then((res) => setDetails((d) => ({ ...d, [id]: res })))
      .catch(() => setDetails((d) => ({ ...d, [id]: { ok: false, error: "Could not load this comparison. Please try again." } })));
  }, []);

  // Load the selected comparison and quietly prefetch the next one.
  useEffect(() => {
    if (!selectedId) return;
    load(selectedId);
    const next = items[items.findIndex((i) => i.id === selectedId) + 1];
    if (next) load(next.id);
  }, [selectedId, items, load]);

  /** Every change of selection goes through here so revealed values and stale errors never carry over to another pair. */
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setRevealed({});
    setError(null);
  }, []);

  const move = useCallback((delta: number) => {
    if (items.length === 0) return;
    const i = Math.min(items.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
    select(items[i].id);
    document.querySelector<HTMLElement>(`[data-suggestion-id="${items[i].id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [items, index, select]);

  const openMerge = useCallback(() => {
    if (!data || data.restricted || !plan || plan.blocked) return;
    setUnderstood(false);
    setError(null);
    setDialog("merge");
  }, [data, plan]);
  const openDismiss = useCallback(() => {
    if (!data || data.restricted) return;
    setReason("");
    setError(null);
    setDialog("dismiss");
  }, [data]);

  const skip = useCallback(() => {
    const to = skipTarget(index, items.length);
    if (to === null) return;
    select(items[to].id);
    document.querySelector<HTMLElement>(`[data-suggestion-id="${items[to].id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index, items, select]);

  const keep = useCallback((side: "a" | "b") => {
    if (!data || data.restricted) return;
    setChoice((c) => ({ ...c, [data.suggestionId]: data.sides[side].id }));
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || dialog) return;
      const action = reviewKeyAction(e);
      if (!action) return;
      if (action === "next") move(1);
      else if (action === "prev") move(-1);
      else if (action === "keep-first") keep("a");
      else if (action === "keep-second") keep("b");
      else if (action === "merge") openMerge();
      else if (action === "skip") skip();
      else openDismiss();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, move, keep, openMerge, openDismiss, skip]);

  /** Slide the decided row out, then drop it and move to the next suggestion. */
  const finish = (id: string, message: string) => {
    const i = items.findIndex((x) => x.id === id);
    const nextId = items[i + 1]?.id ?? items[i - 1]?.id ?? null;
    setDecided((n) => n + 1);
    setNotice(message);
    setDialog(null);
    const remove = () => {
      setItems((list) => list.filter((x) => x.id !== id));
      setLeavingId(null);
      select(nextId);
    };
    if (reducedMotion()) remove();
    else {
      setLeavingId(id);
      window.setTimeout(remove, 230);
    }
  };

  const onFailure = (id: string, code: string, message: string) => {
    setError(message);
    // Someone else already decided it, or a customer was archived: this suggestion is gone for everyone, drop it from the queue.
    if (code === "STALE" || code === "NOT_FOUND") finish(id, message);
  };

  const confirmMerge = () => {
    if (!data || !survivor || !duplicate) return;
    const id = data.suggestionId;
    start(async () => {
      try {
        const res = await mergeSuggestionAction(id, survivor.id, understood);
        if (res.ok) finish(id, `Merged. ${duplicate.first} (${duplicate.code}) is archived and its history now sits with ${survivor.first} (${survivor.code}).`);
        else onFailure(id, res.code, res.error);
      } catch {
        setError("Something went wrong and nothing was changed. Please try again.");
      }
    });
  };

  const confirmDismiss = () => {
    if (!data) return;
    const id = data.suggestionId;
    start(async () => {
      try {
        const res = await dismissSuggestionAction(id, reason);
        if (res.ok) finish(id, "Marked as not the same person. It will only come back if the evidence gets much stronger.");
        else onFailure(id, res.code, res.error);
      } catch {
        setError("Something went wrong and nothing was changed. Please try again.");
      }
    });
  };

  const askManager = () => {
    if (!data) return;
    const id = data.suggestionId;
    start(async () => {
      try {
        const res = await askManagerToReviewAction(id);
        if (res.ok) {
          setAsked((a) => ({ ...a, [id]: true }));
          setNotice(res.alreadyAsked ? "A manager was already asked about this pair." : "Asked a manager to review this pair. It stays open until they decide.");
        } else setError(res.error);
      } catch {
        setError("Something went wrong and nothing was changed. Please try again.");
      }
    });
  };

  const reveal = (side: "a" | "b", field: SensitiveField) => {
    if (!data) return;
    const key = `${side}:${field}`;
    setBusyKey(key);
    revealFieldAction(data.suggestionId, side, field)
      .then((res) => (res.ok ? setRevealed((r) => ({ ...r, [key]: res.value })) : setError(res.error)))
      .catch(() => setError("That could not be shown. Please try again."))
      .finally(() => setBusyKey(null));
  };
  const hide = (side: "a" | "b", field: SensitiveField) =>
    setRevealed((r) => {
      const { [`${side}:${field}`]: _gone, ...rest } = r;
      return rest;
    });

  const heading = (
    <WorkspaceHeading title="Duplicate customers" description="Customers who look like the same person. Compare them, choose which to keep, then merge or dismiss. A merge cannot be undone.">
      <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-live="polite">
        <span>
          <span key={remaining} className={`${styles.tick} text-lg font-semibold tabular-nums text-foreground`}>{remaining}</span>{" "}
          {remaining === 1 ? "suggestion left to review" : "suggestions left to review"}
        </span>
        <span className="hidden text-xs lg:inline">
          Keys: <kbd className={kbd}>1</kbd> <kbd className={kbd}>2</kbd> keep, <kbd className={kbd}>m</kbd> merge, <kbd className={kbd}>s</kbd> skip, <kbd className={kbd}>d</kbd> not the same person, <kbd className={kbd}>j</kbd> <kbd className={kbd}>k</kbd> move
        </span>
      </p>
    </WorkspaceHeading>
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        {notice && <p role="status" className={`${styles.toast} rounded-lg border border-primary/40 bg-accent px-3 py-2 text-sm`}>{notice}</p>}
        <div className="rounded-xl border bg-card px-4 py-12 text-center">
          <p className="font-heading text-base font-semibold">All caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">There are no customers waiting to be reviewed. New suggestions appear here as they are found.</p>
        </div>
      </div>
    );
  }

  const crossRm = !!data?.crossRm;
  const stepper = (
    <div className="flex items-center gap-1 text-xs text-muted-foreground" role="group" aria-label="Move between suggestions">
      <Button type="button" variant="ghost" size="xs" onClick={() => move(-1)} disabled={index <= 0} aria-label="Previous suggestion">Prev</Button>
      <span className="tabular-nums" aria-live="polite">{index < 0 ? 0 : index + 1} of {items.length}</span>
      <Button type="button" variant="ghost" size="xs" onClick={() => move(1)} disabled={index >= items.length - 1} aria-label="Next suggestion">Next</Button>
    </div>
  );

  return (
    <>
      <WorkspaceShell
        hasRail
        header={heading}
        tabs={<WorkspaceTabs tabs={[...TABS]} active={tab} idPrefix="dup" label="Review sections" hrefFor={hrefFor} onSelect={selectTab} />}
        toolbar={stepper}
        rail={
          <StickyRail label="Open suggestions">
            <RailCard title="Open suggestions" labelId="dup-queue">
              <nav aria-label="Open suggestions">
                <ul className="flex flex-col gap-2">
                  {items.map((item, i) => (
                    <QueueRow key={item.id} item={item} index={i} selected={item.id === selectedId} leaving={item.id === leavingId} onSelect={() => select(item.id)} />
                  ))}
                </ul>
              </nav>
            </RailCard>
          </StickyRail>
        }
      >
        <WorkspacePanel tab={tab} idPrefix="dup" busy={!detail}>
          {notice && <p role="status" className={`${styles.toast} rounded-lg border border-primary/40 bg-accent px-3 py-2 text-sm`}>{notice}</p>}
          {!detail && <p className="text-sm text-muted-foreground" role="status">Loading comparison…</p>}
          {detail && !detail.ok && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{detail.error}</div>
          )}
          {data && ownSide && (
            <div key={data.suggestionId} className="flex flex-col gap-4">
              <RestrictedPair own={ownSide} reasons={data.reasons} label={data.label} percent={data.percent} />
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DecisionBar
                keeping={null}
                blocked={null}
                pending={pending}
                crossRm
                canAsk={canAskManager(viewerRole, true)}
                asked={!!asked[data.suggestionId]}
                canSkip={items.length > 1}
                onMerge={openMerge}
                onDismiss={openDismiss}
                onSkip={skip}
                onAsk={askManager}
              />
            </div>
          )}
          {data && !restricted && survivor && duplicate && plan && (
            <div key={data.suggestionId} className="flex flex-col gap-4">
              {tab === "compare" ? (
                <>
                  <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{data.label}</p>
                      <p className="text-xs text-muted-foreground">{data.reasons.join(" · ")}</p>
                    </div>
                    <ConfidenceBar percent={data.percent} label={`${data.label}: ${data.percent} percent`} />
                  </div>
                  <SurvivorChooser sides={data.sides} value={survivor.id} why={data.why} suggestedId={data.defaultSurvivorId} onChange={(id) => setChoice((c) => ({ ...c, [data.suggestionId]: id }))} />
                  <ComparisonTable rows={data.rows} sides={data.sides} revealed={revealed} onReveal={reveal} onHide={hide} busyKey={busyKey} keepingId={survivor.id} />
                </>
              ) : (
                <PlanPreview plan={plan} survivor={survivor.first} duplicate={duplicate.first} />
              )}
              {error && !dialog && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DecisionBar
                keeping={`${survivor.first} (${survivor.code})`}
                blocked={plan.blocked}
                pending={pending}
                crossRm={crossRm}
                canAsk={canAskManager(viewerRole, crossRm)}
                asked={!!asked[data.suggestionId]}
                canSkip={items.length > 1}
                onMerge={openMerge}
                onDismiss={openDismiss}
                onSkip={skip}
                onAsk={askManager}
              />
            </div>
          )}
        </WorkspacePanel>
      </WorkspaceShell>

      <Dialog open={dialog === "merge"} onOpenChange={(o) => !o && !pending && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge these customers?</DialogTitle>
            <DialogDescription>
              {survivor && duplicate ? `${duplicate.first} (${duplicate.code}) will be merged into ${survivor.first} (${survivor.code}).` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="font-medium text-destructive">This cannot be undone.</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{duplicate?.first}&apos;s history moves to {survivor?.first} and cannot be moved back.</li>
              <li>{duplicate?.first}&apos;s record is archived and hidden from every list.</li>
              <li>The merge is written to the audit log with your name.</li>
            </ul>
            <label className="flex items-start gap-2 pt-1">
              <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} aria-label="I understand this merge cannot be undone" />
              <span>I understand this merge cannot be undone.</span>
            </label>
            {error && <p role="alert" className="text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button onClick={confirmMerge} disabled={!understood || pending}>{pending ? "Merging…" : "Merge customers"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "dismiss"} onOpenChange={(o) => !o && !pending && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Not the same person</DialogTitle>
            <DialogDescription>The suggestion leaves the queue. It only returns if the evidence becomes much stronger.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <label htmlFor="dismiss-reason" className="font-medium">Reason (optional)</label>
            <Textarea id="dismiss-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="For example: family members who share a phone" />
            {error && <p role="alert" className="text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button onClick={confirmDismiss} disabled={pending}>{pending ? "Saving…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
