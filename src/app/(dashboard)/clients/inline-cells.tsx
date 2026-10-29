"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { Priority } from "@/generated/prisma/client";
import { PRIORITY_VARIANT } from "@/lib/status-badge-config";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

import { reassignClientAction } from "./actions";
import { scheduleFollowUpAction } from "./quick-view-actions";
import { setClientPriorityAction } from "./view-actions";

/**
 * Inline edits for the clients list: priority, owner and next follow-up, each saved on pick with the change shown at once (rolled
 * back with a toast if the server refuses). Every control stops its click, including clicks inside its portalled menu, so editing
 * never also opens the row's quick view.
 */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const TRIGGER = "group/cell inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 -mx-1 text-left outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none";
const CHEVRON = "size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100";

const PRIORITIES: Priority[] = ["HIGH", "MEDIUM", "LOW"];
const priorityLabel = (p: Priority) => p.charAt(0) + p.slice(1).toLowerCase();

export function PriorityCell({ clientId, clientName, value, canEdit }: { clientId: string; clientName: string; value: Priority; canEdit: boolean }) {
  const [current, setCurrent] = useState(value);
  const [, start] = useTransition();
  const badge = <Badge variant={PRIORITY_VARIANT[current]}>{current}</Badge>;
  if (!canEdit) return badge;

  const save = (next: Priority, undo = false) => {
    if (next === current) return;
    const before = current;
    setCurrent(next);
    start(async () => {
      const r = await setClientPriorityAction(clientId, next).catch(() => ({ ok: false as const, error: "Couldn't save the priority." }));
      if (!r.ok) {
        setCurrent(before);
        toast.error(r.error);
        return;
      }
      if (!undo) toast.success(`${clientName}: priority ${priorityLabel(next).toLowerCase()}`, { action: { label: "Undo", onClick: () => save(before, true) } });
    });
  };

  return (
    <span onClick={stop} onKeyDown={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" className={TRIGGER} aria-label={`Priority for ${clientName}: ${priorityLabel(current)}. Change`} />}>
          {badge}
          <ChevronDown className={CHEVRON} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36" onClick={stop}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Priority</DropdownMenuLabel>
            {PRIORITIES.map((p) => (
              <DropdownMenuItem key={p} onClick={() => save(p)} className="justify-between">
                {priorityLabel(p)} {p === current && <Check aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

export type OwnerOption = { id: string; name: string };

export function OwnerCell({ clientId, clientName, ownerId, ownerName, owners, canEdit }: { clientId: string; clientName: string; ownerId: string | null; ownerName: string | null; owners: OwnerOption[]; canEdit: boolean }) {
  const [current, setCurrent] = useState<{ id: string | null; name: string | null }>({ id: ownerId, name: ownerName });
  const [, start] = useTransition();
  const label = current.name ?? "Unassigned";
  if (!canEdit || owners.length === 0) return <span className="text-sm">{label}</span>;

  const save = (next: OwnerOption, undoTo?: OwnerOption) => {
    if (next.id === current.id) return;
    const before = current;
    setCurrent(next);
    start(async () => {
      try {
        await reassignClientAction(clientId, next.id);
      } catch (e) {
        setCurrent(before);
        toast.error(e instanceof Error ? e.message : "Couldn't reassign this client.");
        return;
      }
      // Undo only back to a real owner: "unassigned" is not something reassign can set.
      if (!undoTo && before.id && before.name) {
        const back = { id: before.id, name: before.name };
        toast.success(`${clientName} is now with ${next.name}`, { action: { label: "Undo", onClick: () => save(back, back) } });
      } else if (!undoTo) toast.success(`${clientName} is now with ${next.name}`);
    });
  };

  return (
    <span onClick={stop} onKeyDown={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" className={cn(TRIGGER, "text-sm", !current.id && "text-muted-foreground")} aria-label={`Owner of ${clientName}: ${label}. Reassign`} />}>
          <span className="truncate">{label}</span>
          <ChevronDown className={CHEVRON} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-52" onClick={stop}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Assign to</DropdownMenuLabel>
            {owners.map((o) => (
              <DropdownMenuItem key={o.id} onClick={() => save(o)} className="justify-between">
                <span className="truncate">{o.name}</span> {o.id === current.id && <Check aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input: tomorrow at 10:00 unless there is already a date. */
function defaultDue(existing: Date | null): string {
  const d = existing && existing.getTime() > Date.now() ? new Date(existing) : new Date(Date.now() + 86_400_000);
  if (!existing || existing.getTime() <= Date.now()) d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FollowUpCell({ clientId, clientName, dueAt, canEdit }: { clientId: string; clientName: string; dueAt: Date | null; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(dueAt);
  const [title, setTitle] = useState("Follow up");
  const [when, setWhen] = useState("");
  const [saving, start] = useTransition();
  // "Now" as of this render's mount: enough to colour an overdue follow-up, and pure across re-renders.
  const [mountedAt] = useState(() => Date.now());
  const overdue = shown !== null && shown.getTime() < mountedAt;
  const text = shown ? formatDateTime(shown) : "—";
  if (!canEdit) return <span className="text-xs text-muted-foreground">{text}</span>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const at = new Date(when);
    if (!title.trim() || Number.isNaN(at.getTime())) return;
    const before = shown;
    setShown(at);
    setOpen(false);
    start(async () => {
      try {
        await scheduleFollowUpAction(clientId, { title: title.trim(), dueAt: when });
        toast.success(`Follow-up set for ${clientName}`);
        router.refresh();
      } catch (err) {
        setShown(before);
        toast.error(err instanceof Error ? err.message : "Couldn't schedule the follow-up.");
      }
    });
  };

  return (
    <span onClick={stop} onKeyDown={stop}>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setWhen(defaultDue(shown)); setTitle("Follow up"); } }}>
        <PopoverTrigger render={<button type="button" className={cn(TRIGGER, "text-xs", overdue ? "text-destructive" : "text-muted-foreground", saving && "opacity-60")} aria-label={`Next follow-up for ${clientName}: ${shown ? text : "none"}. Schedule`} />}>
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          <span>{text}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3" onClick={stop}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <PopoverTitle className="text-sm font-semibold">Schedule a follow-up</PopoverTitle>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`fu-title-${clientId}`}>What</Label>
              <Input id={`fu-title-${clientId}`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`fu-when-${clientId}`}>When</Label>
              <Input id={`fu-when-${clientId}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </div>
            <p className="text-xs text-muted-foreground">Creates a task for this client&apos;s RM.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!title.trim() || !when}>Schedule</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </span>
  );
}
