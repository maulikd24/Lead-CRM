"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motion, useUrlSheet } from "@/components/workspace";
import { ABSTAIN_LABEL, RESULT_LABEL, type DecisionView } from "@/lib/intelligence/decision/view";
import { actionHeadline, channelLabel, CONFIDENCE_NOTE, confidenceLabel } from "./labels";
import { DecisionSheet, DECISION_SHEET } from "./decision-sheet";

/**
 * The decision on one customer, in shadow: a compact summary and the "Why?" control that opens the Evidence Drawer. Shown only to people
 * who may see decisions (Admin, Manager, and an RM for their own customers when NBA_RM_VISIBLE is on); the server decides before rendering.
 */
export function DecisionCard({ view, clientName, canAct, now }: { view: DecisionView; clientName: string; canAct: boolean; now: string }) {
  const { show } = useUrlSheet(DECISION_SHEET);
  const rec = view.result === "RECOMMEND";
  return (
    <>
      <Card size="sm" className={motion.enter} aria-label="Decision Engine v2, shadow mode">
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Decision Engine v2 · shadow review</p>
            <Badge variant={rec ? "accent" : "outline"}>{RESULT_LABEL[view.result]}</Badge>
          </div>
          <p className="font-heading text-base font-semibold">{actionHeadline(view)}</p>
          <p className="text-sm text-muted-foreground">{view.reason}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {view.abstainReason && <Badge variant="warning">{ABSTAIN_LABEL[view.abstainReason] ?? view.abstainReason}</Badge>}
            {rec && <Badge variant="outline">{channelLabel(view.channel)}</Badge>}
            <span className="text-muted-foreground">
              {CONFIDENCE_NOTE}: {confidenceLabel(view.confidence)}
            </span>
          </div>
          <div>
            <button type="button" onClick={show} aria-haspopup="dialog" className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              Why?
            </button>
          </div>
        </CardContent>
      </Card>
      <DecisionSheet view={view} title={clientName} canAct={canAct} now={now} />
    </>
  );
}

