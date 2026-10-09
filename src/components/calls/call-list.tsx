import Link from "next/link";
import { CheckCheck, FileText, Mic, PhoneIncoming, PhoneMissed, PhoneOutgoing, Phone, ChevronRight } from "lucide-react";

import "./calls.css";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/utils/format";
import { OUTCOME_LABEL, type CallRow, type Direction } from "@/lib/calls/view-model";
import { FlagChips } from "./flag-chips";
import { QualityRing } from "./quality-ring";

const DIRECTION = {
  inbound: { label: "Incoming", Icon: PhoneIncoming },
  outbound: { label: "Outgoing", Icon: PhoneOutgoing },
  missed: { label: "Missed", Icon: PhoneMissed },
  unknown: { label: "Call", Icon: Phone },
} satisfies Record<Direction, { label: string; Icon: typeof Phone }>;

const ANALYSIS_TEXT = { none: "Not analysed", pending: "Awaiting transcript", analyzing: "Analysing", done: "", failed: "Analysis failed" } as const;

export function CallList({ rows, showRm, hasAnyCalls }: { rows: CallRow[]; showRm: boolean; hasAnyCalls: boolean }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Phone}
        title={hasAnyCalls ? "No calls match these filters" : "No calls to review yet"}
        description={hasAnyCalls ? "Try widening the date range or clearing a filter." : "Calls appear here once the telephony integration or the Android app syncs them."}
        action={hasAnyCalls ? { label: "Clear filters", href: "/calls" } : undefined}
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border" aria-label="Calls">
      {rows.map((row, index) => {
        const { label, Icon } = DIRECTION[row.direction];
        const analysisText = ANALYSIS_TEXT[row.analysis];
        return (
          <li key={row.id} className="calls-rise" style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
            <Link
              href={`/calls/${row.id}`}
              className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto]"
            >
              <QualityRing score={row.score} />
              <div className="min-w-0">
                <p className="truncate font-heading text-sm font-semibold">{row.customerName}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{row.outcome === "connected" ? row.durationLabel : OUTCOME_LABEL[row.outcome]}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={row.occurredAt.toISOString()}>{formatDateTime(row.occurredAt)}</time>
                  {showRm && row.rmName && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{row.rmName}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="col-span-3 col-start-1 row-start-2 flex flex-wrap items-center gap-2 pl-[60px] sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:pl-0">
                <FlagChips flags={row.flags} />
                {analysisText && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    {(row.analysis === "pending" || row.analysis === "analyzing") && <span className="calls-live size-1.5 rounded-full bg-primary" aria-hidden="true" />}
                    {analysisText}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {row.hasRecording && <Mic className="size-4" aria-label="Has recording" role="img" />}
                {row.hasTranscript && <FileText className="size-4" aria-label="Has transcript" role="img" />}
                {row.reviewed && (
                  <Badge variant="success">
                    <CheckCheck aria-hidden="true" />
                    Reviewed
                  </Badge>
                )}
                <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
