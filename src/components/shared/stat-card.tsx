import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/motion/count-up";
import type { ReactNode } from "react";

export type StatTone = "default" | "success" | "warning" | "destructive";

const TONE_TEXT: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

const TONE_BG: Record<StatTone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
  trend,
  animated = false,
  accessory,
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  tone?: StatTone;
  trend?: { direction: "up" | "down"; value: string };
  /** Count the number up (numbers only). Off by default so other pages are unchanged. */
  animated?: boolean;
  /** Optional element beside the value, e.g. a sparkline. */
  accessory?: ReactNode;
}) {
  const valueNode = (
    <p
      className={cn(
        "font-heading font-semibold tabular-nums tracking-tight",
        typeof value === "string" && value.length > 12 ? "text-lg leading-snug" : "text-3xl",
        TONE_TEXT[tone],
      )}
    >
      {animated && typeof value === "number" ? <CountUp value={value} /> : value}
    </p>
  );
  // Only wrap when there is something beside the value, so every other page keeps its original DOM.
  const valueRow = accessory ? (
    <div className="flex items-end justify-between gap-2">
      {valueNode}
      {accessory}
    </div>
  ) : (
    valueNode
  );
  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          {Icon && (
            <span className={cn("flex size-6 items-center justify-center rounded-full", TONE_BG[tone])}>
              <Icon className="size-3.5" />
            </span>
          )}
        </div>
        {valueRow}
        {trend && (
          <p className={cn("flex items-center gap-1 text-xs", trend.direction === "up" ? "text-success" : "text-destructive")}>
            <TrendIcon className="size-3" />
            {trend.value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
