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
import { bulkReassignClientsAction } from "./actions";

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
  children,
}: {
  rms: { id: string; name: string }[];
  children: ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetRmId, setTargetRmId] = useState("");
  const [pending, setPending] = useState(false);

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

  return (
    <SelectionContext.Provider value={{ selectedIds, toggle, isSelected: (id) => selectedIds.has(id) }}>
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2">
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
        </div>
      )}
      {children}
    </SelectionContext.Provider>
  );
}
