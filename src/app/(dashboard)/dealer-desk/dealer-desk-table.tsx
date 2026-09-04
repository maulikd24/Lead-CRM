"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/utils/format";
import type { Client, DealerIntroduction, Stage, DealerIntroStatus } from "@/generated/prisma/client";
import { updateDealerHandoffStatusAction } from "./actions";

type SerializedDealerIntroduction = Omit<DealerIntroduction, "maxOrderValue" | "maxExposureLimit"> & {
  maxOrderValue: number | null;
  maxExposureLimit: number | null;
};

type DealerDeskClient = Omit<Client, "expectedInvestment"> & {
  expectedInvestment: number | null;
  dealerIntroduction: SerializedDealerIntroduction | null;
  currentStage: Stage;
};

const STATUS_VARIANT: Record<DealerIntroStatus, "outline" | "secondary" | "default"> = {
  PENDING: "outline",
  SCHEDULED: "secondary",
  COMPLETED: "default",
};

export function DealerDeskTable({ clients }: { clients: DealerDeskClient[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Client</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead>Portfolio Preference</TableHead>
          <TableHead>Trading Limits</TableHead>
          <TableHead>Handoff Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => (
          <DealerHandoffRow key={client.id} client={client} />
        ))}
        {clients.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
              No clients have been handed off to you yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function DealerHandoffRow({ client }: { client: DealerDeskClient }) {
  const intro = client.dealerIntroduction;
  const [status, setStatus] = useState<DealerIntroStatus>(intro?.status ?? "PENDING");
  const [remarks, setRemarks] = useState(intro?.remarks ?? "");
  const [pending, setPending] = useState(false);

  async function handleSave() {
    if (!intro) return;
    setPending(true);
    try {
      await updateDealerHandoffStatusAction(intro.id, { status, remarks: remarks || undefined });
      toast.success("Handoff status updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update handoff status");
    } finally {
      setPending(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="text-sm">
        <p className="font-medium">{client.name}</p>
        <p className="text-xs text-muted-foreground font-mono">{client.clientCode}</p>
      </TableCell>
      <TableCell className="text-sm">
        <p>{client.mobile}</p>
        {client.email && <p className="text-xs text-muted-foreground">{client.email}</p>}
      </TableCell>
      <TableCell className="text-sm">{client.currentStage.name}</TableCell>
      <TableCell className="text-sm">
        <p>{intro?.preferredSegments?.length ? intro.preferredSegments.join(", ") : "—"}</p>
        {intro?.riskProfile && <p className="text-xs text-muted-foreground">{intro.riskProfile}</p>}
      </TableCell>
      <TableCell className="text-sm">
        {intro?.maxOrderValue && <p>Order: ₹{formatNumber(Number(intro.maxOrderValue))}</p>}
        {intro?.maxExposureLimit && <p>Exposure: ₹{formatNumber(Number(intro.maxExposureLimit))}</p>}
        {!intro?.maxOrderValue && !intro?.maxExposureLimit && "—"}
      </TableCell>
      <TableCell className="text-sm">
        <div className="flex flex-col gap-2 min-w-48">
          <Badge variant={STATUS_VARIANT[status]} className="w-fit">
            {status}
          </Badge>
          <Select value={status} onValueChange={(v) => setStatus(v as DealerIntroStatus)}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="SCHEDULED">Scheduled</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            rows={2}
            placeholder="Remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
