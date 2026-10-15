import { CheckCircle2 } from "lucide-react";

import { AttentionControls, type AttentionAct } from "@/components/attention/attention-controls";
import { Badge } from "@/components/ui/badge";
import type { AttentionItem } from "@/lib/attention/engine";
import { ANOMALY_COPY, type AnomalyType } from "@/lib/marketing/campaign-anomalies";

/** One row per anomaly (a campaign and a kind). A repeat of the same pair is shown once. */
export function dedupeAnomalies(items: readonly AttentionItem[]): AttentionItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.subject.id}:${i.subKind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const known = (k: string | null): k is AnomalyType => k !== null && k in ANOMALY_COPY;

export function AnomalyTable({ items, act, emptyTitle }: { items: readonly AttentionItem[]; act: AttentionAct; emptyTitle: string }) {
  const rows = dedupeAnomalies(items);
  if (rows.length === 0) {
    return <p className="flex items-center gap-2 rounded-xl border border-border px-3 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-success" aria-hidden />{emptyTitle}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border" role="region" aria-label="Campaign anomalies" tabIndex={0}>
      <table className="w-full min-w-[44rem] text-left text-sm">
        <caption className="sr-only">One row per anomaly, with the reason and the next step</caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Campaign</th>
            <th scope="col" className="px-3 py-2 font-medium">Anomaly</th>
            <th scope="col" className="px-3 py-2 font-medium">Reason</th>
            <th scope="col" className="px-3 py-2 font-medium">Next step</th>
            <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Not now</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-t border-border align-top">
              <th scope="row" className="px-3 py-2 font-medium">{i.subject.label}</th>
              <td className="px-3 py-2">
                <Badge variant={i.score >= 60 ? "destructive" : "secondary"}>{known(i.subKind) ? ANOMALY_COPY[i.subKind].label : i.kindLabel}</Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{i.detail}</td>
              <td className="px-3 py-2">{known(i.subKind) ? ANOMALY_COPY[i.subKind].nextStep : "Open the campaign and check it."}</td>
              <td className="px-3 py-2">
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Not now</summary>
                  <div className="pt-2"><AttentionControls itemId={i.id} hard={i.override !== "none"} act={act} /></div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
