import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { CHANNELS } from "@/lib/planner/channels";
import { STATUS_LABELS, type PlanStatus } from "@/lib/planner/workflow";
import type { PlanView } from "@/lib/planner/types";

/** Small shared pieces of the planner screens. */
const STATUS_VARIANT: Record<PlanStatus, "secondary" | "warning" | "success" | "accent"> = { DRAFT: "secondary", NEEDS_REVIEW: "warning", APPROVED: "success", SCHEDULED: "accent" };

export function StatusBadge({ status }: { status: PlanStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function NotLiveBadge({ status }: { status: string }) {
  return status === "LIVE" ? null : <Badge variant="warning">{status === "OFF" ? "Off: not live yet" : "Not live yet"}</Badge>;
}

export function PlanChip({ plan }: { plan: PlanView }) {
  return (
    <Link href={`/planner/${plan.id}`} className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-md border bg-card px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <span className="truncate font-medium text-foreground">{plan.title}</span>
      <span className="flex flex-wrap items-center gap-1">
        <StatusBadge status={plan.status} />
        {plan.failing.length > 0 && plan.status !== "SCHEDULED" ? <span className="text-muted-foreground">{plan.failing.length} to fix</span> : null}
      </span>
    </Link>
  );
}

export const channelLabel = (key: string) => (CHANNELS as Record<string, { label: string }>)[key]?.label ?? key;

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{children}</p>;
}

export const inr = (n: number | null) => (n == null ? "Not set" : `INR ${new Intl.NumberFormat("en-IN").format(n)}`);
