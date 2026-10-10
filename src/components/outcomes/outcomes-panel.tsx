import { Plus, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, type MasterItem } from "@/components/workspace";
import { STATIC_COPY } from "@/lib/outcomes/copy";
import { outcomeListItems } from "@/lib/outcomes/master-items";
import type { OutcomesViewModel } from "@/lib/outcomes/view-model";

import { AttentionScoreCard } from "./attention-score";
import { GoalCard } from "./goals-board";
import { GoalDialog } from "./goal-dialog";
import { ReviewCard } from "./review-card";
import { SuggestionCard } from "./suggestions-list";

const STATUS_VARIANT = { success: "success", warning: "warning", default: "secondary" } as const;

/**
 * The Goals and outcomes section of Customer 360, as master-detail: a compact list (score and review, each goal, suggestions) with
 * Up/Down keys, and the chosen item in full beside it. Each side scrolls inside itself, so the page never does. On a phone the list
 * shows its top 5 and an item opens in a full-height sheet.
 */
export function OutcomesPanel({ vm }: { vm: OutcomesViewModel }) {
  const dialogProps = { clientId: vm.clientId, holdingOptions: vm.holdingOptions, accountOptions: vm.accountOptions };
  const items: MasterItem[] = outcomeListItems(vm).map((i) => ({
    id: i.id,
    title: i.title,
    meta: i.meta,
    trailing: i.status ? <Badge variant={STATUS_VARIANT[i.tone ?? "default"]}>{i.status}</Badge> : undefined,
  }));

  const details: Record<string, React.ReactNode> = {
    overview: (
      <div className="@container flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <AttentionScoreCard score={vm.score} />
          <ReviewCard clientId={vm.clientId} review={vm.review} canEdit={vm.canEdit} />
        </div>
      </div>
    ),
    suggestions: (
      <section aria-labelledby="suggestions-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="suggestions-heading" className="font-heading text-lg font-semibold">{STATIC_COPY.suggestionsTitle}</h2>
          <p className="text-xs text-muted-foreground">{STATIC_COPY.rulesNote} {STATIC_COPY.tasksOnly}</p>
        </div>
        {vm.suggestions.length === 0 ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">{STATIC_COPY.suggestionsEmpty}</p> : (
          <ul className="flex flex-col gap-3">
            {vm.suggestions.map((s, i) => (
              <li key={`${s.ruleKey}:${s.fingerprint}`}>
                <SuggestionCard clientId={vm.clientId} s={s} index={i} />
              </li>
            ))}
          </ul>
        )}
      </section>
    ),
  };
  vm.goals.forEach((g, i) => {
    details[`goal:${g.id}`] = <GoalCard goal={g} index={i} canEdit={vm.canEdit} clientId={vm.clientId} dialogProps={dialogProps} />;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-sm text-muted-foreground max-lg:hidden">{STATIC_COPY.tabIntro}</p>
        {vm.canEdit && <GoalDialog {...dialogProps} trigger={<Button size="sm"><Plus aria-hidden className="size-4" /> Add goal</Button>} />}
      </div>
      <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{vm.disclaimer}</p>
      {vm.goals.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Target aria-hidden className="size-4 shrink-0" />
          {STATIC_COPY.noGoals}
        </p>
      )}
      <MasterDetail idPrefix="outcomes" label="Goals and outcomes" items={items} details={details} noun="items" />
    </div>
  );
}
