import { AlertTriangle, TrendingDown, UserX, Sparkles } from "lucide-react";

import { StatCard } from "@/components/shared/stat-card";
import { KpiTileSkeleton } from "@/components/shared/skeletons";
import type { WorklistSummary } from "@/lib/copilot/worklist";

export function CopilotSummary({ summary }: { summary: WorklistSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Critical" value={summary.critical} icon={AlertTriangle} tone="destructive" />
      <StatCard label="At Risk" value={summary.atRisk} icon={TrendingDown} tone="warning" />
      <StatCard label="Disengaged" value={summary.disengaged} icon={UserX} tone="warning" />
      <StatCard label="Cross-sell Candidates" value={summary.crossSellCandidates} icon={Sparkles} />
    </div>
  );
}

export function CopilotSummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <KpiTileSkeleton key={i} />
      ))}
    </div>
  );
}
