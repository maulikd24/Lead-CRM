"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import styles from "./suggestion-stack.module.css";
import { hideItem, parseHidden, restoreItem, swipeOutcome, visibleItems, type Hidden } from "./suggest-logic";

export type Suggestion = {
  id: string;
  title: string;
  /** Who or what it is about (a client name). */
  subject: string;
  /** Why it is suggested. Always shown: a suggestion without a reason is not shown. */
  reason: string;
  href?: string;
};

type Props = {
  items: Suggestion[];
  /** Accepting does something internal and reversible (the caller creates a task). It never sends anything to a customer. */
  onAccept: (item: Suggestion) => Promise<void>;
  /** Per person and per place, so two people sharing a browser keep their own snoozes. */
  storageKey: string;
  acceptLabel?: string;
};

/**
 * A stack of suggestion cards: the top one is live, two more peek out beneath it. Accept, snooze for a day or dismiss with the buttons
 * (the same three work for keyboard and screen reader users) or by swiping the card right (accept) or left (dismiss). Every card shows
 * its reason. Snoozes and dismissals are remembered in this browser only, and each has an Undo. The idea follows Cult UI's agent
 * suggestion card stack (MIT, https://www.cult-ui.com), restyled in our tokens, with no animation library.
 */
export function SuggestionStack({ items, onAccept, storageKey, acceptLabel = "Create task" }: Props) {
  const [hidden, setHidden] = useState<Hidden>({});
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState<{ id: string; dir: "left" | "right" } | null>(null);
  const [dx, setDx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const drag = useRef<{ x: number; pointer: number } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setHidden(parseHidden(window.localStorage.getItem(storageKey), Date.now()));
    } catch {
      // storage unavailable: nothing is remembered, everything still works
    }
    setReady(true);
  }, [storageKey]);

  const persist = useCallback(
    (next: Hidden) => {
      setHidden(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // see above
      }
    },
    [storageKey],
  );

  const visible = ready ? visibleItems(items, hidden, Date.now()) : items;
  const top = visible[0];

  const finish = useCallback(
    (item: Suggestion, how: "accept" | "snooze" | "dismiss", dir: "left" | "right") => {
      setLeaving({ id: item.id, dir });
      window.setTimeout(() => {
        setLeaving(null);
        setDx(0);
        if (how === "accept") {
          persist(hideItem(hidden, item.id, "dismiss", Date.now()));
        } else {
          const next = hideItem(hidden, item.id, how, Date.now());
          persist(next);
          setAnnounce(`${how === "snooze" ? "Snoozed until tomorrow" : "Dismissed"}: ${item.title}.`);
          toast(`${how === "snooze" ? "Snoozed until tomorrow" : "Dismissed"}: ${item.title}`, { action: { label: "Undo", onClick: () => persist(restoreItem(next, item.id)) } });
        }
      }, 200);
    },
    [hidden, persist],
  );

  async function accept(item: Suggestion) {
    if (busy) return;
    setBusy(true);
    try {
      await onAccept(item);
      setAnnounce(`Task created: ${item.title}.`);
      toast.success("Task created", { description: `${item.title}: ${item.subject}` });
      finish(item, "accept", "right");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the task");
    } finally {
      setBusy(false);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button, a")) return;
    drag.current = { x: e.clientX, pointer: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || drag.current.pointer !== e.pointerId) return;
    setDx(e.clientX - drag.current.x);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!drag.current || !top) return;
    const outcome = swipeOutcome(dx, (e.currentTarget as HTMLElement).offsetWidth);
    drag.current = null;
    if (outcome === "accept") void accept(top);
    else if (outcome === "dismiss") finish(top, "dismiss", "left");
    else setDx(0);
  }

  if (!top) {
    return (
      <p className={styles.empty} data-testid="suggestions-empty">
        <Check aria-hidden className="size-4" /> You are all caught up. Snoozed suggestions come back tomorrow.
      </p>
    );
  }

  const layers = visible.slice(0, 3);
  return (
    <div className={styles.wrap}>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <div className={styles.stack} data-count={layers.length}>
        {layers
          .map((item, depth) => ({ item, depth }))
          .reverse()
          .map(({ item, depth }) => {
            const isTop = depth === 0;
            const out = leaving?.id === item.id ? leaving.dir : null;
            return (
              <div
                key={item.id}
                ref={isTop ? topRef : undefined}
                className={cn(styles.card, isTop && styles.top)}
                data-depth={depth}
                data-leaving={out ?? undefined}
                data-dragging={isTop && dx !== 0 && !out ? "true" : undefined}
                aria-hidden={isTop ? undefined : true}
                role={isTop ? "group" : undefined}
                aria-roledescription={isTop ? "suggestion" : undefined}
                aria-label={isTop ? `${item.title}, ${item.subject}. Suggestion 1 of ${visible.length}.` : undefined}
                style={isTop && !out ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)` } : undefined}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? () => { drag.current = null; setDx(0); } : undefined}
              >
                <p className={styles.title}>{item.title}</p>
                <p className={styles.subject}>{item.subject}</p>
                <p className={styles.reason}><span className="font-semibold text-foreground">Why: </span>{item.reason}</p>
                {isTop && item.href && (
                  <Link href={item.href} className={styles.open}>Open client</Link>
                )}
              </div>
            );
          })}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={() => finish(top, "dismiss", "left")} aria-label={`Dismiss: ${top.title}`}>
          <X aria-hidden className="size-4" /> Dismiss
        </button>
        <button type="button" className={styles.btn} onClick={() => finish(top, "snooze", "left")} aria-label={`Snooze until tomorrow: ${top.title}`}>
          <Clock aria-hidden className="size-4" /> Snooze
        </button>
        <button type="button" className={cn(styles.btn, styles.primary)} onClick={() => void accept(top)} disabled={busy} aria-label={`${acceptLabel}: ${top.title}`}>
          <Check aria-hidden className="size-4" /> {busy ? "Creating…" : acceptLabel}
        </button>
      </div>
      <p className={styles.hint}>
        {visible.length > 1 ? `${visible.length - 1} more behind this one. ` : ""}Suggestions only: accepting creates a task, nothing is sent to a customer.
      </p>
    </div>
  );
}
