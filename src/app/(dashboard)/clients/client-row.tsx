"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BlockerBadge } from "@/components/blocker-badge";
import { HygieneWarningBadge } from "@/components/hygiene-badge";
import { formatDate, formatDateTime, formatStageAge } from "@/lib/utils/format";
import { ClientCheckbox } from "./clients-bulk-selection";
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
  nextActionTitle,
  nextActionDueAt,
  blockerReason,
  slaStatus,
  status,
  assignedToName,
  createdAt,
  lastActivityAt,
}: {
  id: string;
  clientCode: string;
  name: string;
  mobile: string;
  stageName: string;
  ageHours: number;
  priority: Priority;
  nextActionTitle: string | null;
  nextActionDueAt: Date | null;
  blockerReason: string | null;
  slaStatus: SlaStatus;
  status: ClientStatus;
  assignedToName: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
}) {
  const router = useRouter();

  return (
    <TableRow
      onClick={() => router.push(`/clients/${id}`)}
      className="cursor-pointer hover:bg-muted/50"
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        <ClientCheckbox id={id} />
      </TableCell>
      <TableCell>
        <Link
          href={`/clients/${id}`}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {name}
        </Link>
        <p className="text-xs text-muted-foreground font-mono">{clientCode}</p>
      </TableCell>
      <TableCell className="text-sm">{mobile}</TableCell>
      <TableCell className="text-sm">{stageName}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatStageAge(ageHours)}</TableCell>
      <TableCell>
        <Badge variant={PRIORITY_VARIANT[priority]}>{priority}</Badge>
      </TableCell>
      <TableCell className="text-sm max-w-40 truncate">
        {nextActionTitle ?? (status === "ACTIVE" ? <HygieneWarningBadge /> : "—")}
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
    </TableRow>
  );
}
