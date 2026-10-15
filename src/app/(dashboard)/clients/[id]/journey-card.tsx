import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { customerJourneysEnabled } from "@/lib/journeys/customer-journey-flag";
import { FIRST_INVESTMENT_JOURNEY, type JourneyEvaluation, type JourneyOwnerRole, type StepEvaluation } from "@/lib/journeys/customer-journey";
import { loadCustomerJourney } from "@/lib/journeys/customer-journey-loader";
import type { TimelineViewer } from "@/lib/timeline/reader";
import { formatDate } from "@/lib/utils/format";

const OWNER_LABEL: Record<JourneyOwnerRole, string> = { rm: "RM", ops: "Ops", compliance: "Compliance" };

const STATUS: Record<StepEvaluation["status"], { label: string; variant: "success" | "destructive" | "outline" }> = {
  done: { label: "Done", variant: "success" },
  overdue: { label: "Overdue", variant: "destructive" },
  not_started: { label: "Not started", variant: "outline" },
};

/** One plain-language sentence per step, shown when the row is opened. Recommendation only: it says what is due and who owns it. */
function stepSentence(step: StepEvaluation): string {
  const owner = OWNER_LABEL[step.ownerRole];
  if (step.status === "done") return `Completed on ${formatDate(new Date(step.completedAt as string))}.`;
  if (step.status === "overdue") return `Overdue. It was due on ${formatDate(new Date(step.dueAt as string))}. ${owner} to act.`;
  if (step.dueAt) return `Not started. Due by ${formatDate(new Date(step.dueAt))}. ${owner} to act.`;
  return `Not started. ${owner} to act when the step before it is done.`;
}

/**
 * The journey card on the customer record Overview tab. Renders nothing when JOURNEYS_ENABLED is off, and nothing when the viewer may not
 * open this customer (the loader answers forbidden or not_found, so no journey data reaches a viewer who does not own the lead). Read only.
 */
export async function JourneyCard({ clientId, viewer }: { clientId: string; viewer: TimelineViewer }) {
  if (!customerJourneysEnabled()) return null;
  const loaded = await loadCustomerJourney(clientId, FIRST_INVESTMENT_JOURNEY, { viewer });
  if (!loaded.ok) return null;
  return <JourneyView evaluation={loaded.evaluation} historyComplete={loaded.historyComplete} />;
}

/** Pure view of one evaluation. Compact: one row per step, the sentence is behind a disclosure so the phone layout stays short. */
export function JourneyView({ evaluation, historyComplete }: { evaluation: JourneyEvaluation; historyComplete: boolean }) {
  const title = FIRST_INVESTMENT_JOURNEY.name;
  const next = evaluation.next;
  return (
    <Card data-testid="journey-card">
      <CardHeader>
        <CardTitle className="text-base">Journey: {title}</CardTitle>
        <CardDescription>
          {evaluation.complete
            ? "All steps are done."
            : next
              ? `Next: ${next.label}, owner ${OWNER_LABEL[next.ownerRole]}${next.status === "overdue" ? " (overdue)" : ""}.`
              : null}{" "}
          A recommendation only. Nothing is sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!historyComplete && (
          <p className="text-xs text-muted-foreground">This customer has a long event history. Earlier steps may be under-counted.</p>
        )}
        <ol className="flex flex-col divide-y divide-border">
          {evaluation.steps.map((step) => (
            <li key={step.stepId}>
              <details className="group py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 truncate font-medium">{step.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{OWNER_LABEL[step.ownerRole]}</span>
                    <Badge variant={STATUS[step.status].variant}>{STATUS[step.status].label}</Badge>
                  </span>
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">{stepSentence(step)}</p>
              </details>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
