"use client";

import Link from "next/link";

import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BlockerBadge } from "@/components/blocker-badge";
import { formatDate, formatDateTime, formatStageAge } from "@/lib/utils/format";
import { ClientCheckbox } from "./clients-bulk-selection";
import { isPlainClick, useClientQuickView } from "@/components/clients/client-quick-view";
import { motionEnabled } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";
import { CLIENT_STATUS_VARIANT as STATUS_VARIANT, PRIORITY_VARIANT, SLA_VARIANT } from "@/lib/status-badge-config";
import type { SlaStatus } from "@/lib/stage-engine/sla-status";
import type { Priority, ClientStatus } from "@/generated/prisma/client";

export function ClientRow({
  id,
  clientCode,
  name,
  mobile,
  stageName,
  ageHours,
  priority,
  nextStepLabel,
  nextActionTitle,
  nextActionDueAt,
  blockerReason,
  slaStatus,
  status,
  assignedToName,
  createdAt,
  lastActivityAt,
  lifetimeRevenue,
  index = 0,
}: {
  id: string;
  clientCode: string;
  name: string;
  mobile: string | null;
  stageName: string;
  ageHours: number;
  priority: Priority;
  nextStepLabel: string | null;
  nextActionTitle: string | null;
  nextActionDueAt: Date | null;
  blockerReason: string | null;
  slaStatus: SlaStatus;
  status: ClientStatus;
  assignedToName: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  /** Shown only to roles that may see revenue; undefined hides the column. */
  lifetimeRevenue?: number;
  /** Position on the page: rows ease in one after another when a page or filter loads. */
  index?: number;
}) {
  const openQuickView = useClientQuickView();

  return (
    <TableRow
      onClick={() => openQuickView(id)}
      className={cn(
        "cursor-pointer hover:bg-muted/50",
        motionEnabled() && "duration-200 animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none",
      )}
      style={motionEnabled() ? { animationDelay: `${Math.min(index, 12) * 20}ms` } : undefined}
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        <ClientCheckbox id={id} name={name} />
      </TableCell>
      <TableCell>
        <Link
          href={`/clients/${id}`}
          className="font-medium hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            if (!isPlainClick(e)) return;
            e.preventDefault();
            openQuickView(id);
          }}
        >
          {name}
        </Link>
        <p className="text-xs text-muted-foreground font-mono">{clientCode}</p>
      </TableCell>
      <TableCell className="text-sm">{mobile ?? "—"}</TableCell>
      <TableCell className="text-sm">{stageName}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatStageAge(ageHours)}</TableCell>
      <TableCell>
        <Badge variant={PRIORITY_VARIANT[priority]}>{priority}</Badge>
      </TableCell>
      <TableCell className="text-sm max-w-40 truncate">
        <span title={nextActionTitle ?? undefined}>{nextStepLabel ?? "—"}</span>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {nextActionDueAt ? formatDateTime(nextActionDueAt) : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={SLA_VARIANT[slaStatus]}>{slaStatus.replace(/_/g, " ")}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge variant={STATUS_VARIANT[status]}>{status.replace(/_/g, " ")}</Badge>
          <BlockerBadge reason={blockerReason} />
        </div>
      </TableCell>
      <TableCell className="text-sm">{assignedToName ?? "Unassigned"}</TableCell>
      <TableCell className="text-muted-foreground text-sm">{formatDate(createdAt)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {lastActivityAt ? formatDateTime(lastActivityAt) : "—"}
      </TableCell>
      {lifetimeRevenue !== undefined && (
        <TableCell className="text-right text-sm tabular-nums">
          {lifetimeRevenue > 0 ? `₹${Math.round(lifetimeRevenue).toLocaleString("en-IN")}` : "—"}
        </TableCell>
      )}
    </TableRow>
  );
}
