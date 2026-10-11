"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import { moveLeadStageAction } from "@/app/(dashboard)/leads/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  announceCancel,
  announceDrop,
  announceLift,
  announceOver,
  groupByStage,
  moveCard,
  neighbourStage,
  speedToLead,
  type BoardCard,
  type BoardStage,
} from "@/lib/leads/kanban-logic";
import { initials } from "@/lib/utils";

import styles from "./pipeline-board.module.css";

type Props = {
  stages: BoardStage[];
  cards: BoardCard[];
  /** Real number of active leads per stage (the board shows the newest few of each). */
  totals: Record<string, number>;
  /** Admins and managers only. Everyone else gets the same board, read-only. */
  canMove: boolean;
};

const PER_COLUMN = 30;

// The speed-to-lead clock: one tick a minute. null on the server and on the first client render, so both agree.
const minuteListeners = new Set<() => void>();
let minuteTimer: number | null = null;
let minuteNow = 0;
function subscribeMinute(cb: () => void) {
  minuteListeners.add(cb);
  if (minuteTimer === null) {
    minuteTimer = window.setInterval(() => {
      minuteNow = Date.now();
      minuteListeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    minuteListeners.delete(cb);
    if (minuteListeners.size === 0 && minuteTimer !== null) {
      window.clearInterval(minuteTimer);
      minuteTimer = null;
    }
  };
}
function useMinuteClock(): number | null {
  return useSyncExternalStore(
    subscribeMinute,
    () => (minuteNow || (minuteNow = Date.now())),
    () => null,
  );
}
/** How long the Undo toast stays up. This is a reading window, not an animation. */
const UNDO_WINDOW_MS = 8000;

/**
 * The Leads pipeline as a board. The idea and the interaction model come from Cult UI's kanban (MIT, https://www.cult-ui.com), written
 * here in our own code and tokens with no drag-and-drop dependency: pointer drag (HTML5), a full keyboard drag (Space lifts, arrows
 * choose a stage, Space drops, Escape cancels), a "Move to" select as the plain alternative (and the touch path), and a polite live
 * region that announces every step. A move is optimistic, goes through the real stage correction (with audit), rolls back on refusal,
 * and shows an Undo toast.
 */
export function PipelineBoard({ stages, cards: initial, totals, canMove }: Props) {
  const [cards, setCards] = useState(initial);
  // New data from the server (after a refresh) replaces what is shown: derived during render, not in an effect.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCards(initial);
  }
  const now = useMinuteClock();
  const [overStage, setOverStage] = useState<string | null>(null);
  const [lifted, setLifted] = useState<{ id: string; target: string } | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  const commitRef = useRef<(cardId: string, toStageId: string, undo?: boolean) => void>(() => {});

  const columns = useMemo(() => groupByStage(stages, cards), [stages, cards]);
  const stageName = useCallback((id: string) => stages.find((s) => s.id === id)?.name ?? "stage", [stages]);

  const commit = useCallback(
    (cardId: string, toStageId: string, undo = false) => {
      const card = cardsRef.current.find((c) => c.id === cardId);
      if (!card || card.stageId === toStageId || !canMove) return;
      const from = card.stageId;
      setCards((prev) => moveCard(prev, cardId, toStageId)); // optimistic
      setLanded(cardId);
      window.setTimeout(() => setLanded((l) => (l === cardId ? null : l)), 320);
      setAnnouncement(announceDrop(card.name, stageName(toStageId)));
      startTransition(async () => {
        const res = await moveLeadStageAction(cardId, toStageId, undo);
        if (!res.ok) {
          setCards((prev) => moveCard(prev, cardId, from));
          setAnnouncement(`${card.name} could not be moved. ${res.error}`);
          toast.error(res.error);
        } else if (res.pendingApproval) {
          setCards((prev) => moveCard(prev, cardId, from));
          setAnnouncement(`${card.name} stays in ${stageName(from)} until the move is approved.`);
          toast(`Sent for approval: ${card.name} stays in ${stageName(from)} until it is approved.`);
        } else if (!undo) {
          toast.success(`${card.name} moved to ${stageName(toStageId)}`, { action: { label: "Undo", onClick: () => commitRef.current(cardId, from, true) }, duration: UNDO_WINDOW_MS });
        } else {
          toast.success(`${card.name} is back in ${stageName(toStageId)}`);
        }
      });
    },
    [canMove, stageName],
  );
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>, card: BoardCard, columnCards: BoardCard[]) {
    if (!canMove) return;
    if (e.target !== e.currentTarget) return; // keys inside the card's link or select behave as usual
    if (!lifted) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setLifted({ id: card.id, target: card.stageId });
        setAnnouncement(announceLift(card.name, stageName(card.stageId), columnCards.findIndex((c) => c.id === card.id) + 1, columnCards.length));
      }
      return;
    }
    if (lifted.id !== card.id) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const target = neighbourStage(stages, lifted.target, e.key === "ArrowRight" ? 1 : -1);
      setLifted({ id: card.id, target });
      setAnnouncement(announceOver(card.name, stageName(target)));
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const target = lifted.target;
      setLifted(null);
      commit(card.id, target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setLifted(null);
      setAnnouncement(announceCancel(card.name));
    }
  }

  return (
    <div className={styles.wrap}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {!canMove && <p className={styles.note}>You can see your pipeline here. Stages move with KYC and funding; only managers and admins can move one by hand.</p>}
      <div className={styles.board} role="group" aria-label="Pipeline stages">
        {columns.map(({ stage, cards: stageCards }) => {
          const total = totals[stage.id] ?? stageCards.length;
          const shown = stageCards.slice(0, PER_COLUMN);
          const hidden = Math.max(0, total - shown.length);
          const isTarget = overStage === stage.id || lifted?.target === stage.id;
          return (
            <section
              key={stage.id}
              aria-labelledby={`col-${stage.id}`}
              className={styles.column}
              data-target={isTarget && canMove ? "true" : undefined}
              onDragOver={(e) => {
                if (!canMove) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverStage(stage.id);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) commit(id, stage.id);
              }}
            >
              <header className={styles.colHead}>
                <h2 id={`col-${stage.id}`} className={styles.colTitle}>{stage.name}</h2>
                <span className={styles.count} aria-label={`${total} leads`}>{total}</span>
              </header>
              <ul className={styles.cards}>
                {shown.length === 0 && <li className={styles.empty}>No leads here</li>}
                {shown.map((card) => {
                  const stl = speedToLead(card.createdAtIso, card.firstContactAtIso, now ?? Date.parse(card.createdAtIso));
                  const showTimer = now !== null && stage.sequence === columns[0].stage.sequence;
                  const isLifted = lifted?.id === card.id;
                  return (
                    <li key={card.id}>
                      <article
                        className={styles.card}
                        data-lifted={isLifted ? "true" : undefined}
                        data-landed={landed === card.id ? "true" : undefined}
                        draggable={canMove}
                        tabIndex={canMove ? 0 : undefined}
                        aria-roledescription={canMove ? "draggable lead" : undefined}
                        aria-label={`${card.name}, ${stage.name}${canMove ? ". Press Space to pick up." : ""}`}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", card.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setOverStage(null)}
                        onKeyDown={(e) => onKeyDown(e, card, stageCards)}
                      >
                        <div className={styles.cardTop}>
                          <Link href={`/clients/${card.id}`} className={styles.name} draggable={false}>{card.name}</Link>
                          {card.priority === "HIGH" && <span className={styles.high} title="High priority">High</span>}
                        </div>
                        <div className={styles.meta}>
                          <span className="font-mono">{card.code}</span>
                          {card.campaign && <span className={styles.chip} title={`Campaign: ${card.campaign}`}>{card.campaign}</span>}
                        </div>
                        <div className={styles.foot}>
                          <span className={styles.rm} title={card.rmName ?? "Unassigned"}>
                            <Avatar size="sm"><AvatarFallback className="text-xs font-semibold">{card.rmName ? initials(card.rmName) : "?"}</AvatarFallback></Avatar>
                            <span className="sr-only">{card.rmName ? `RM ${card.rmName}` : "Unassigned"}</span>
                          </span>
                          {showTimer && <span className={styles.timer} data-warn={stl.warn ? "true" : undefined}>{stl.label}</span>}
                        </div>
                        {canMove && (
                          <label className={styles.moveLabel}>
                            <span className="sr-only">Move {card.name} to</span>
                            <select
                              className={styles.move}
                              value={card.stageId}
                              onChange={(e) => commit(card.id, e.target.value)}
                              aria-label={`Move ${card.name} to stage`}
                              draggable={false}
                            >
                              {stages.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </article>
                    </li>
                  );
                })}
                {hidden > 0 && (
                  <li>
                    <Link href={`/clients?stage=${stage.id}`} className={styles.more}>{hidden} more in the list</Link>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
