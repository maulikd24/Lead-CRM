"use client";

import { useUrlSheet, Sheet } from "@/components/workspace";
import type { DecisionView } from "@/lib/intelligence/decision/view";
import { EvidenceDrawerActions, EvidenceDrawerBody } from "./evidence-drawer";

export const DECISION_SHEET = "decision";

/** The Evidence Drawer as a workspace Sheet: a side drawer from 1024px, a bottom sheet on a phone. State lives in `?sheet=decision`, so it can be deep-linked and Back closes it. */
export function DecisionSheet({ view, title, canAct, now }: { view: DecisionView; title: string; canAct: boolean; now: string }) {
  const { open, hide } = useUrlSheet(DECISION_SHEET);
  return (
    <Sheet name={DECISION_SHEET} open={open} onClose={hide} title="Why this action?" description={title} footer={<EvidenceDrawerActions view={view} canAct={canAct} />}>
      <EvidenceDrawerBody view={view} now={new Date(now)} />
    </Sheet>
  );
}
