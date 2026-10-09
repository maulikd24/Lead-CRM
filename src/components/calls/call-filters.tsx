import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BAND_LABEL, OUTCOME_LABEL, type CallFilters } from "@/lib/calls/view-model";

const CONTROL = "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** A plain GET form: the URL is the filter state, so a filtered view can be bookmarked and needs no client script. */
export function CallFiltersForm({ filters, rms, showRm }: { filters: CallFilters; rms: { id: string; name: string }[]; showRm: boolean }) {
  const active = Object.values(filters).some((v) => v !== null && v !== false);
  return (
    <form method="get" action="/calls" className="flex flex-wrap items-end gap-3" aria-label="Filter calls">
      {showRm && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          RM
          <select name="rm" defaultValue={filters.rm ?? ""} className={CONTROL}>
            <option value="">Everyone</option>
            {rms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        From
        <input type="date" name="from" defaultValue={filters.from ?? ""} className={CONTROL} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        To
        <input type="date" name="to" defaultValue={filters.to ?? ""} className={CONTROL} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Outcome
        <select name="outcome" defaultValue={filters.outcome ?? ""} className={CONTROL}>
          <option value="">Any</option>
          {(Object.keys(OUTCOME_LABEL) as (keyof typeof OUTCOME_LABEL)[]).map((k) => (
            <option key={k} value={k}>
              {OUTCOME_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Quality score
        <select name="band" defaultValue={filters.band ?? ""} className={CONTROL}>
          <option value="">Any</option>
          {(Object.keys(BAND_LABEL) as (keyof typeof BAND_LABEL)[]).map((k) => (
            <option key={k} value={k}>
              {BAND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex items-center gap-4 pb-2 text-sm">
        <legend className="sr-only">Only show calls that</legend>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="flagged" value="1" defaultChecked={filters.flaggedOnly} className="size-4 accent-primary" />
          Are flagged
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="recording" value="1" defaultChecked={filters.hasRecording} className="size-4 accent-primary" />
          Have a recording
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="transcript" value="1" defaultChecked={filters.hasTranscript} className="size-4 accent-primary" />
          Have a transcript
        </label>
      </fieldset>
      <div className="flex items-center gap-2 pb-0.5">
        <Button type="submit" size="sm">
          Apply
        </Button>
        {active && (
          <Button variant="ghost" size="sm" render={<Link href="/calls" />}>
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
