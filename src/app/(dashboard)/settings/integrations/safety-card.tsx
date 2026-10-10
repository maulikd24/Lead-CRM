import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { SafetyItem } from "@/lib/integrations/overview";
import { StateBadge } from "./status-badge";

/** A read-only status card for AI and safety. Shows whether a server setting is in place, never its value. */
export function SafetyCard({ item, index }: { item: SafetyItem; index: number }) {
  return (
    <Card className={cn(motion.enter, motion.lift)} style={{ "--i": index } as React.CSSProperties}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{item.label}</CardTitle>
          <CardDescription>{item.description}</CardDescription>
        </div>
        <StateBadge state={item.state} />
      </CardHeader>
      {item.detail && (
        <CardContent>
          <p className="text-xs text-muted-foreground">Set on the server: <span className="font-mono">{item.detail}</span></p>
        </CardContent>
      )}
    </Card>
  );
}
