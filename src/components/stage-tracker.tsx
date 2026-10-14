import { Check } from "lucide-react";

import type { ClientStatus, Stage } from "@/generated/prisma/client";
import { isStageDone, stageLabel } from "@/lib/stage-engine/stage-label";

export function StageTracker({
  stages,
  currentSequence,
  clientStatus,
}: {
  stages: Stage[];
  currentSequence: number;
  clientStatus: ClientStatus;
}) {
  const current = stages.find((s) => s.sequence === currentSequence);
  return (
    <>
      {/* Phone: one row, the stage and a segmented bar side by side; the full tracker needs sideways scrolling */}
      <div className="flex items-center gap-3 lg:hidden" role="img" aria-label={`Stage ${current?.sequence ?? "?"} of ${stages.length}: ${current ? stageLabel(current.name) : "unknown"}`}>
        <p className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          Stage {current?.sequence ?? "?"} of {stages.length}: <span className="font-semibold text-foreground">{current ? stageLabel(current.name) : "Unknown"}</span>
        </p>
        <div className="flex min-w-0 flex-1 gap-1" aria-hidden>
          {stages.map((stage) => (
            <span key={stage.id} className={`h-1 flex-1 rounded-full ${stage.sequence <= currentSequence ? "bg-primary" : "bg-muted-foreground/20"}`} />
          ))}
        </div>
      </div>
    <div className="hidden items-center overflow-x-auto py-2 lg:flex">
      {stages.map((stage, i) => {
        const isCurrent = stage.sequence === currentSequence;
        const isLastStage = i === stages.length - 1;
        const isDone = isStageDone(stage, { sequence: currentSequence, clientStatus }, isLastStage);
        return (
          <div key={stage.id} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-1.5 w-24">
              <div
                className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-medium shrink-0 ${
                  isDone
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-primary text-primary"
                      : "border-muted-foreground/30 text-muted-foreground"
                }`}
              >
                {isDone ? <Check className="size-3.5" /> : stage.sequence}
              </div>
              <span
                className={`text-xs text-center leading-tight ${
                  isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {stageLabel(stage.name)}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className={`h-0.5 w-6 shrink-0 -mt-4 ${isDone ? "bg-primary" : "bg-muted-foreground/20"}`} />
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}
