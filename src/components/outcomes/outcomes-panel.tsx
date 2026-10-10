import type { OutcomesViewModel } from "@/lib/outcomes/view-model";
import { STATIC_COPY } from "@/lib/outcomes/copy";

import { AttentionScoreCard } from "./attention-score";
import { GoalsBoard } from "./goals-board";
import { ReviewCard } from "./review-card";
import { SuggestionsList } from "./suggestions-list";

/** The Goals and outcomes section of Customer 360: score and cadence side by side, then goals, then suggestions. */
export function OutcomesPanel({ vm }: { vm: OutcomesViewModel }) {
  return (
    <div className="@container flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{STATIC_COPY.tabIntro}</p>
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
        <AttentionScoreCard score={vm.score} />
        <ReviewCard clientId={vm.clientId} review={vm.review} canEdit={vm.canEdit} />
      </div>
      <GoalsBoard vm={vm} />
      <SuggestionsList clientId={vm.clientId} suggestions={vm.suggestions} />
    </div>
  );
}
