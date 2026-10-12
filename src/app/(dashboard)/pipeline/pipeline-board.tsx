"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowRight, GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatInrCompact, formatStageAge } from "@/lib/utils/format";
import { SLA_VARIANT } from "@/lib/status-badge-config";
import { classifyDrop } from "@/lib/pipeline/board-logic";
import type { BoardCard, BoardColumn } from "@/lib/pipeline/board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClientQuickViewProvider, isPlainClick, useClientQuickView } from "@/components/clients/client-quick-view";
import { MotionNumber } from "@/components/motion/motion-number";
import { flipFrom } from "@/components/motion/flip";
import { motionEnabled } from "@/components/motion/tokens";
import { MoveDialog, CorrectStageDialog, type PendingMove } from "./move-dialogs";

export function PipelineBoard({ columns, role, completedWindowDays }: { columns: BoardColumn[]; role: string; completedWindowDays: number }) {
  const router = useRouter();
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [correction, setCorrection] = useState<PendingMove | null>(null);
  // Dragging is for mouse and touch. Keyboard and screen-reader users move a card from its handle's "Move to" menu, which
  // reaches every stage directly instead of nudging a card across a scrolling board.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const columnOf = (stageId: string | undefined) => columns.find((c) => c.stageId === stageId);
  const cardById = (id: string) => columns.flatMap((c) => c.cards.map((card) => ({ card, column: c }))).find((x) => x.card.id === id);
  const lastSequence = columns.at(-1)?.sequence;

  // After a move, the card glides from where it was into its new column (FLIP) — "every number follows" from the reel.
  const flip = useRef<{ id: string; rect: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const pending = flip.current;
    if (!pending || !motionEnabled()) return;
    const el = document.querySelector<HTMLElement>(`[data-card-id="${pending.id}"]`);
    flip.current = null;
    if (el) flipFrom(el, pending.rect);
  }, [columns]);

  function request(card: BoardCard, from: BoardColumn, to: BoardColumn) {
    const rect = document.querySelector(`[data-card-id="${card.id}"]`)?.getBoundingClientRect();
    flip.current = rect ? { id: card.id, rect } : null;
    const intent = classifyDrop(from.sequence, to.sequence, role);
    if (intent.kind === "advance") setMove({ card, from, to });
    else if (intent.kind === "correct") setCorrection({ card, from, to });
    else if (intent.kind === "denied") toast.info(intent.message);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const found = cardById(String(event.active.id));
    const to = columnOf(event.over?.id as string | undefined);
    if (found && to) request(found.card, found.column, to);
  }

  const done = () => {
    setMove(null);
    setCorrection(null);
    router.refresh();
  };

  return (
    <ClientQuickViewProvider>
      {/* A fixed id keeps dnd-kit's generated ids the same on the server and in the browser (no hydration mismatch). */}
      <DndContext
        id="pipeline-board"
        sensors={sensors}
        onDragStart={(e) => setDragging(cardById(String(e.active.id))?.card ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-4" role="list" aria-label="Onboarding stages">
          {columns.map((column, index) => (
            <Column key={column.stageId} column={column} index={index} isFinal={column.sequence === lastSequence} completedWindowDays={completedWindowDays}>
              {column.cards.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  column={column}
                  columns={columns}
                  next={column.sequence === lastSequence ? undefined : columns[index + 1]}
                  onMove={(to) => request(card, column, to)}
                />
              ))}
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <CardBody card={dragging} lifted /> : null}</DragOverlay>
      </DndContext>
      <MoveDialog move={move} onClose={() => setMove(null)} onDone={done} />
      <CorrectStageDialog move={correction} role={role} onClose={() => setCorrection(null)} onDone={done} />
    </ClientQuickViewProvider>
  );
}

function Column({ column, index, isFinal, completedWindowDays, children }: { column: BoardColumn; index: number; isFinal: boolean; completedWindowDays: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stageId });
  const hidden = column.count - column.cards.length;
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${column.name}, ${column.count} client${column.count === 1 ? "" : "s"}`}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-xl border bg-muted/30 p-2 transition-colors",
        // Columns ease in one after another on first load (they never remount, so this plays once).
        motionEnabled() && "duration-300 animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both motion-reduce:animate-none",
        isOver && "border-primary bg-primary/5",
      )}
      style={motionEnabled() ? { animationDelay: `${index * 40}ms` } : undefined}
    >
      <header className="flex flex-col gap-0.5 px-1.5 pt-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{column.name}</h2>
          <Badge variant="outline" className="tabular-nums">
            <MotionNumber value={column.count} />
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          <MotionNumber value={column.totalExpected} format="inr-compact" /> expected
          {column.weightedExpected !== null && column.winRate !== null && !isFinal && (
            <span title={`${Math.round(column.winRate * 100)}% of clients who reached this stage in the last year completed onboarding`}>
              {" "}· ~<MotionNumber value={column.weightedExpected} format="inr-compact" /> likely
            </span>
          )}
        </p>
        {isFinal && <p className="text-xs text-muted-foreground">Completed in the last {completedWindowDays} days</p>}
      </header>
      {/* Each column scrolls on its own, so the page stays one screen tall however many clients a stage holds. */}
      <ul className="flex max-h-[60svh] min-h-24 flex-col gap-2 overflow-y-auto overscroll-contain lg:max-h-[calc(100svh-17rem)]">{children}</ul>
      {hidden > 0 && (
        <Link href={column.listHref} className="px-1.5 pb-1 text-xs text-primary underline-offset-2 hover:underline">
          +{hidden} more in the list
        </Link>
      )}
    </section>
  );
}

function Card({ card, column, columns, next, onMove }: { card: BoardCard; column: BoardColumn; columns: BoardColumn[]; next: BoardColumn | undefined; onMove: (to: BoardColumn) => void }) {
  // Only pointer/touch listeners: the handle's own keyboard behaviour is its menu, not a drag.
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.id });
  return (
    <li ref={setNodeRef} {...listeners} data-card-id={card.id} className={cn("touch-manipulation", isDragging && "opacity-40")}>
      <CardBody
        card={card}
        handle={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Move ${card.name}`}
                  className="-ml-1 cursor-grab rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
                />
              }
            >
              <GripVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                {columns
                  .filter((c) => c.stageId !== column.stageId)
                  .map((c) => (
                    <DropdownMenuItem key={c.stageId} onClick={() => onMove(c)}>
                      {c.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        footer={
          next && (
            <Button size="xs" variant="ghost" onClick={() => onMove(next)} aria-label={`Move ${card.name} to ${next.name}`}>
              Next stage <ArrowRight className="size-3" />
            </Button>
          )
        }
      />
    </li>
  );
}

function CardBody({ card, handle, footer, lifted }: { card: BoardCard; handle?: React.ReactNode; footer?: React.ReactNode; lifted?: boolean }) {
  const openQuickView = useClientQuickView();
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-card-foreground shadow-xs", lifted && "rotate-1 shadow-lg")}>
      <div className="flex items-start gap-1.5">
        {handle}
        <div className="min-w-0 flex-1">
          <Link
            href={`/clients/${card.id}`}
            onClick={(e) => {
              if (!isPlainClick(e)) return;
              e.preventDefault();
              openQuickView(card.id);
            }}
            className="block truncate text-sm font-medium hover:underline"
          >
            {card.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{card.clientCode}</span> · {card.assignedToName ?? "Unassigned"}
          </p>
        </div>
        {card.priority === "HIGH" && <Badge variant="destructive">Hot</Badge>}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums">{card.expectedInvestment ? formatInrCompact(card.expectedInvestment) : "—"}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title="Time in this stage">{formatStageAge(card.ageHours)}</span>
          {card.slaStatus !== "NOT_APPLICABLE" && card.slaStatus !== "ON_TRACK" && (
            <Badge variant={SLA_VARIANT[card.slaStatus]}>{card.slaStatus === "OVERDUE" ? "Overdue" : "Due soon"}</Badge>
          )}
        </span>
      </div>
      {footer && <div className="-mb-1 flex justify-end">{footer}</div>}
    </div>
  );
}
