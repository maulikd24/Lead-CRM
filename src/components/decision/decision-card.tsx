"use client";

import { Badge } from "@/components/ui/badge";
import { PhoneFold } from "@/components/c360/phone-fold";
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
      {/* Folded on a phone (open from 1024 px): the card would otherwise push the customer page past the phone height budget once the Wave 2 screens are merged. */}
      <PhoneFold
        className={`${motion.enter} rounded-xl border border-border bg-card text-card-foreground`}
        summary={
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="truncate">Decision Engine v2 · shadow review</span>
            <Badge variant={rec ? "secondary" : "outline"}>{RESULT_LABEL[view.result]}</Badge>
          </span>
        }
      >
        <div aria-label="Decision Engine v2, shadow mode" className="flex flex-col gap-2 px-4 pb-3">
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
        </div>
      </PhoneFold>
      <DecisionSheet view={view} title={clientName} canAct={canAct} now={now} />
    </>
  );
}

