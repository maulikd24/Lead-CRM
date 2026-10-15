"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopilotQuickActions } from "@/components/copilot/quick-actions";
import type { PriorityScore, HealthResult } from "@/lib/copilot/scoring";
import type { CrossSellFlag } from "@/lib/copilot/cross-sell";
import type { MilestoneItem } from "@/lib/copilot/milestones";
import type { MessageSuggestion } from "@/lib/copilot/message-suggestion";

const HEALTH_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HEALTHY: "default",
  AT_RISK: "secondary",
  CRITICAL: "destructive",
};

export function ClientCopilotPanel({
  clientId,
  assignedToId,
  priority,
  health,
  crossSell,
  milestones,
  messageSuggestion,
  suggestedFollowUp,
  users,
}: {
  clientId: string;
  assignedToId: string | null;
  priority: PriorityScore;
  health: HealthResult;
  crossSell: CrossSellFlag[];
  milestones: MilestoneItem[];
  messageSuggestion: MessageSuggestion | null;
  suggestedFollowUp: { title: string; dueAtIso: string };
  users: { id: string; name: string }[];
}) {
  const blocked = milestones.find((m) => m.status === "blocked");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Co-pilot</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge variant={HEALTH_VARIANT[health.status]}>{health.status.replace("_", " ")}</Badge>
          <span className="text-xs text-muted-foreground">Priority {priority.score}</span>
        </div>
        {(health.reasons[0] || priority.reasons[0]) && (
          <p className="text-xs text-muted-foreground -mt-2">{health.reasons[0] ?? priority.reasons[0]}</p>
        )}

        {/* The next step is shown once, in the page header. */}
        <CopilotQuickActions
          clientId={clientId}
          assignedToId={assignedToId}
          suggestedFollowUp={suggestedFollowUp}
          messageSuggestion={messageSuggestion}
          users={users}
        />

        {crossSell.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Cross-sell</p>
            <div className="flex flex-col gap-1">
              {crossSell.map((flag) => (
                <div key={flag.label} className="text-xs">
                  <span className="font-medium">{flag.label}</span>
                  <span className="text-muted-foreground"> — {flag.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The stage tracker at the top is the milestone list; only a blocker is added here. */}
        {blocked?.blockingReason && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{blocked.stageName}:</span> {blocked.blockingReason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
