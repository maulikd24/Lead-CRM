import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Kpi } from "@/lib/partners/view-models";
import { CountUp } from "./count-up";

const TONE_TEXT = { default: "text-foreground", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;
const TONE_BG = { default: "bg-muted text-muted-foreground", success: "bg-success/10 text-success", warning: "bg-warning/10 text-warning", destructive: "bg-destructive/10 text-destructive" } as const;

export function KpiTile({ kpi, icon: Icon, index, pulse }: { kpi: Kpi; icon: LucideIcon; index: number; pulse?: boolean }) {
  return (
    <Card size="sm" className="pw-rise" style={{ "--pw-i": index } as React.CSSProperties}>
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-center justify-between">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {pulse && <span aria-hidden className="pw-live size-1.5 shrink-0 rounded-full bg-warning" />}
            {kpi.label}
          </p>
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", TONE_BG[kpi.tone])}>
            <Icon className="size-3.5" />
            
          </span>
        </div>
        <p className={cn("font-heading text-3xl font-semibold tracking-tight", kpi.format === "inr" && "text-2xl", TONE_TEXT[kpi.tone])}>
          <CountUp value={kpi.value} format={kpi.format} />
        </p>
        {kpi.hint && <p className="text-xs text-muted-foreground">{kpi.hint}</p>}
      </CardContent>
    </Card>
  );
}
