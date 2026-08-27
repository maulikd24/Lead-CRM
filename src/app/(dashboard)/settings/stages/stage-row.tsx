"use client";

import { useState } from "react";
import { toast } from "sonner";

import { TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { updateStageAction } from "./actions";
import type { Stage } from "@/generated/prisma/client";

export function StageRow({ stage }: { stage: Stage }) {
  const [slaHours, setSlaHours] = useState(stage.slaHours);
  const [isActive, setIsActive] = useState(stage.isActive);
  const [pending, setPending] = useState(false);

  async function save(next: { slaHours: number; isActive: boolean }) {
    setPending(true);
    try {
      await updateStageAction(stage.id, next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update stage");
    } finally {
      setPending(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{stage.sequence}</TableCell>
      <TableCell className="font-medium">{stage.name}</TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          className="w-24"
          value={slaHours}
          disabled={pending}
          onChange={(e) => setSlaHours(Number(e.target.value))}
          onBlur={() => save({ slaHours, isActive })}
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={isActive}
          disabled={pending}
          onCheckedChange={(checked) => {
            setIsActive(checked);
            save({ slaHours, isActive: checked });
          }}
        />
      </TableCell>
      <TableCell>
        <Badge variant={isActive ? "default" : "outline"}>{isActive ? "Active" : "Inactive"}</Badge>
      </TableCell>
    </TableRow>
  );
}
