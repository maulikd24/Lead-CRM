"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { reviewKey, type Armed } from "@/lib/agents/review-keys";
import { cn } from "@/lib/utils";
import { ProposalCard, type Draft, type ProposalCardHandle } from "./proposal-card";

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * Drafts to review: the queue on the left (stacked above on a phone), the open draft on the right, one at a time. J and K move,
 * A or R arm approve or reject and the same key (or Enter) confirms, E edits. Approval is always two steps; see review-keys.ts.
 */
export function DraftsReview({ drafts, canAct }: { drafts: Draft[]; canAct: boolean }) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<Armed>(null);
  const [announce, setAnnounce] = useState("");
  const card = useRef<ProposalCardHandle>(null);

  const visible = drafts.filter((d) => !removed.has(d.id));
  const index = Math.max(0, visible.findIndex((d) => d.id === selectedId));
  const current = visible[index] ?? null;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setArmed(null);
  }, []);

  const onDecided = useCallback(
    (id: string, kind: "sent" | "rejected") => {
      const at = visible.findIndex((d) => d.id === id);
      const next = visible[at + 1] ?? visible[at - 1] ?? null;
      const name = visible[at]?.client.name ?? "the customer";
      setRemoved((r) => new Set(r).add(id));
      setSelectedId(next?.id ?? null);
      setArmed(null);
      setAnnounce(kind === "sent" ? `Approved and sent to ${name}.` : `Rejected the draft for ${name}.`);
    },
    [visible],
  );

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 6000); // an armed key does not wait forever
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || !current) return;
      const res = reviewKey(e.key, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey }, armed, { typing: isTyping(e.target), canAct, busy: card.current?.busy() ?? false });
      if (res.intent.kind === "none" && res.armed === armed) return;
      if (res.intent.kind !== "none") e.preventDefault();
      setArmed(res.armed);
      const intent = res.intent;
      if (intent.kind === "move") {
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + intent.delta))];
        if (next) setSelectedId(next.id);
      } else if (intent.kind === "run") {
        if (intent.action === "approve") card.current?.approve();
        else card.current?.reject();
      } else if (intent.kind === "edit") card.current?.focusEditor();
      else if (intent.kind === "blur" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, canAct, current, index, visible]);

  if (visible.length === 0) {
    return (
      <>
        <Card>
          <CardContent>
            <EmptyState icon={Sparkles} title="No drafts waiting" description="Nothing is sent until you approve it." />
          </CardContent>
        </Card>
        <p role="status" className="sr-only">{announce}</p>
      </>
    );
  }

  return (
    <div className="@container">
      <p role="status" className="sr-only">{announce}</p>
      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Drafts waiting" className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 @2xl:hidden">
            <span className="text-sm text-muted-foreground tabular-nums">Draft {index + 1} of {visible.length}</span>
            <div className="flex gap-1">
              <Button size="icon" variant="outline" aria-label="Previous draft" disabled={index === 0} onClick={() => select(visible[index - 1].id)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="icon" variant="outline" aria-label="Next draft" disabled={index === visible.length - 1} onClick={() => select(visible[index + 1].id)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <ul className="hidden flex-col gap-1.5 @2xl:flex">
            {visible.map((d, i) => (
              <li key={d.id} className={motion.enter} style={{ ["--i" as string]: i }}>
                <button
                  type="button"
                  onClick={() => select(d.id)}
                  aria-current={d.id === current?.id ? "true" : undefined}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    d.id === current?.id && "border-primary bg-primary/10",
                  )}
                >
                  <span className="truncate font-medium">{d.client.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{d.programme ?? d.reason}</span>
                  <span className="text-xs text-muted-foreground">{d.expiry}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {current && <ProposalCard key={current.id} draft={current} canAct={canAct} armed={armed} onDecided={onDecided} handle={card} />}
      </div>
    </div>
  );
}
