"use client";

import { useState } from "react";
import { Waypoints } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDate, formatNumber } from "@/lib/utils/format";
import type { RevenueType, TransactionType } from "@/generated/prisma/client";

export type PayoutLineTrace = {
  id: string;
  amount: number;
  commissionAccrual: {
    accrualAmount: number;
    accrualDate: Date;
    revenueEvent: {
      revenueType: RevenueType;
      grossRevenueAmount: number;
      eventDate: Date;
      sourceSystem: string;
      transaction: { transactionType: TransactionType; transactionDate: Date; grossAmount: number; externalRef: string } | null;
    };
  };
};

/** Payout -> PayoutLine -> CommissionAccrual -> RevenueEvent -> Transaction, walked as a vertical
 * stepper — reuses ActivityTimeline's visual idiom (icon circle + connecting line) without the
 * Activity-specific data model it's built around. */
export function PayoutTraceDrawer({ line }: { line: PayoutLineTrace }) {
  const [open, setOpen] = useState(false);
  const { commissionAccrual: accrual } = line;
  const { revenueEvent: event } = accrual;

  const steps = [
    { label: "PayoutLine", detail: `₹${formatNumber(line.amount)}` },
    { label: "CommissionAccrual", detail: `₹${formatNumber(accrual.accrualAmount)} on ${formatDate(accrual.accrualDate)}` },
    {
      label: "RevenueEvent",
      detail: `${event.revenueType.replace(/_/g, " ")} · ₹${formatNumber(event.grossRevenueAmount)} on ${formatDate(event.eventDate)} (${event.sourceSystem})`,
    },
    ...(event.transaction
      ? [
          {
            label: "Transaction",
            detail: `${event.transaction.transactionType} · ₹${formatNumber(event.transaction.grossAmount)} on ${formatDate(event.transaction.transactionDate)} · ${event.transaction.externalRef}`,
          },
        ]
      : []),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <Waypoints className="size-3.5" />
        Trace
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trace</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col">
          {steps.map((step, i) => (
            <div key={step.label} className="flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{i + 1}</div>
                {i < steps.length - 1 && <div className="w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 pb-1">
                <p className="text-sm font-medium">{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
