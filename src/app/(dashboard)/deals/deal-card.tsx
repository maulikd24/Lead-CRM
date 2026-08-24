"use client";

import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Deal, Lead, Contact, PipelineStage } from "@/generated/prisma/client";
import { moveDealStageAction } from "./actions";
import { formatNumber } from "@/lib/utils/format";

type DealWithRelations = Omit<Deal, "value"> & {
  value: number;
  lead: Lead | null;
  contact: Contact | null;
};

export function DealCard({ deal, stages }: { deal: DealWithRelations; stages: PipelineStage[] }) {
  async function handleStageChange(stageId: string | null) {
    if (!stageId) return;
    try {
      await moveDealStageAction(deal.id, stageId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move deal");
    }
  }

  return (
    <Card>
      <CardContent className="p-3 flex flex-col gap-2">
        <p className="text-sm font-medium">{deal.title}</p>
        <p className="text-xs text-muted-foreground">
          {deal.lead?.name ?? deal.contact?.name ?? "No linked contact"}
        </p>
        <p className="text-sm font-semibold">₹{formatNumber(deal.value)}</p>
        <Select value={deal.stageId} onValueChange={handleStageChange}>
          <SelectTrigger className="w-full h-8 text-xs">
            <SelectValue>
              {(value: string) => stages.find((s) => s.id === value)?.name ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
