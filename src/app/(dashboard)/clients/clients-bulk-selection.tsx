"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bulkReassignClientsAction, bulkPutOnHoldAction, bulkMarkNotProceedingAction } from "./actions";
import { HOLD_REASONS, NOT_PROCEEDING_REASONS } from "@/lib/clients/options";
import type { Role } from "@/generated/prisma/client";

type SelectionContextValue = {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useClientSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useClientSelection must be used within ClientsBulkSelection");
  return ctx;
}

export function ClientCheckbox({ id }: { id: string }) {
  const { isSelected, toggle } = useClientSelection();
  return (
    <Checkbox
      checked={isSelected(id)}
      onCheckedChange={() => toggle(id)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function ClientSelectAllHeader({ pageClientIds }: { pageClientIds: string[] }) {
  const { selectedIds, toggle } = useClientSelection();
  const allSelected = pageClientIds.length > 0 && pageClientIds.every((id) => selectedIds.has(id));

  function handleToggleAll() {
    if (allSelected) {
      pageClientIds.forEach((id) => {
        if (selectedIds.has(id)) toggle(id);
      });
    } else {
      pageClientIds.forEach((id) => {
        if (!selectedIds.has(id)) toggle(id);
      });
    }
  }

  return <Checkbox checked={allSelected} onCheckedChange={handleToggleAll} />;
}

export function ClientsBulkSelection({
  rms,
  currentUserRole,
  children,
}: {
  rms: { id: string; name: string }[];
  currentUserRole: Role;
  children: ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetRmId, setTargetRmId] = useState("");
  const [holdReason, setHoldReason] = useState(HOLD_REASONS[0]);
  const [npReason, setNpReason] = useState(NOT_PROCEEDING_REASONS[0]);
  const [pending, setPending] = useState(false);
  const canBulkMutate = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkReassign() {
    if (!targetRmId || selectedIds.size === 0) return;
    setPending(true);
    try {
      const { reassigned } = await bulkReassignClientsAction([...selectedIds], targetRmId);
      const rmName = rms.find((r) => r.id === targetRmId)?.name ?? "RM";
      toast.success(`${reassigned.length} client(s) reassigned to ${rmName}`);
      setSelectedIds(new Set());
      setTargetRmId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reassign clients");
    } finally {
      setPending(false);
    }
  }

  async function handleBulkHold() {
    if (selectedIds.size === 0) return;
    setPending(true);
    try {
      const { updated } = await bulkPutOnHoldAction([...selectedIds], holdReason);
      toast.success(`${updated.length} client(s) put on hold`);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to put clients on hold");
    } finally {
      setPending(false);
    }
  }

  async function handleBulkNotProceeding() {
    if (selectedIds.size === 0) return;
    setPending(true);
    try {
      const { updated } = await bulkMarkNotProceedingAction([...selectedIds], npReason);
      toast.success(`${updated.length} client(s) marked not proceeding`);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update clients");
    } finally {
      setPending(false);
    }
  }

  const exportSelectedHref = `/api/clients/export?ids=${[...selectedIds].map(encodeURIComponent).join(",")}`;

  return (
    <SelectionContext.Provider value={{ selectedIds, toggle, isSelected: (id) => selectedIds.has(id) }}>
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2">
          <span className="text-sm text-muted-foreground px-2">{selectedIds.size} selected</span>
          <Select value={targetRmId} onValueChange={(v) => v && setTargetRmId(v)}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Reassign to...">
                {(v: string) => rms.find((r) => r.id === v)?.name ?? "Reassign to..."}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {rms.map((rm) => (
                <SelectItem key={rm.id} value={rm.id}>
                  {rm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!targetRmId || pending} onClick={handleBulkReassign}>
            {pending ? "Reassigning..." : `Reassign ${selectedIds.size} client(s)`}
          </Button>

          {canBulkMutate && (
            <>
              <Select value={holdReason} onValueChange={(v) => v && setHoldReason(v)}>
                <SelectTrigger className="w-48 h-8 text-xs">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HOLD_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={pending} onClick={handleBulkHold}>
                Put {selectedIds.size} On Hold
              </Button>

              <Select value={npReason} onValueChange={(v) => v && setNpReason(v)}>
                <SelectTrigger className="w-48 h-8 text-xs">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {NOT_PROCEEDING_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="destructive" disabled={pending} onClick={handleBulkNotProceeding}>
                Mark {selectedIds.size} Not Proceeding
              </Button>
            </>
          )}

          <Button size="sm" variant="outline" render={<a href={exportSelectedHref} />}>
            Export Selected ({selectedIds.size})
          </Button>
        </div>
      )}
      {children}
    </SelectionContext.Provider>
  );
}
