import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  tone?: StatTone;
  trend?: { direction: "up" | "down"; value: string };
}) {
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
        <p className={cn("font-heading text-3xl font-semibold tabular-nums tracking-tight", TONE_TEXT[tone])}>{value}</p>
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
