import { Check, CircleAlert, Eye, EyeOff, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MergePlan } from "@/lib/identity/merge-review/plan";
import type { CompareRow, SensitiveField } from "@/lib/identity/merge-review/view-model";
import type { QueueItem } from "@/lib/identity/merge-review/load";
import styles from "./duplicates.module.css";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/** Animated confidence meter. A progressbar with a text value, so the percentage is never conveyed by the bar alone. */
export function ConfidenceBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cx(styles.barTrack, "w-full min-w-16")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
        <div className={cx(styles.barFill, percent < 80 && styles.barFillSoft)} style={{ width: `${percent}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">{percent}%</span>
    </div>
  );
}

export function QueueRow({ item, index, selected, leaving, onSelect }: { item: QueueItem; index: number; selected: boolean; leaving: boolean; onSelect: () => void }) {
  return (
    <li className={cx(styles.rowIn, leaving && styles.leaving)} style={{ ["--i" as string]: Math.min(index, 12) }}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-suggestion-id={item.id}
        className={cx(
          "flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          selected ? "border-primary bg-accent" : "border-border bg-card hover:bg-muted",
        )}
      >
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
          <span>{item.a.first} <span className="text-xs font-normal text-muted-foreground">{item.a.code}</span></span>
          <span aria-hidden className="text-muted-foreground">and</span>
          <span className="sr-only">and</span>
          <span>{item.b.first} <span className="text-xs font-normal text-muted-foreground">{item.b.code}</span></span>
        </span>
        <ConfidenceBar percent={item.percent} label={`${item.label}: ${item.percent} percent`} />
        <span className="flex flex-wrap gap-1">
          {item.reasons.map((r) => (
            <Badge key={r} variant="outline" className="text-[0.7rem]">{r}</Badge>
          ))}
        </span>
      </button>
    </li>
  );
}

type Side = { id: string; first: string; code: string };

export function SurvivorChooser({ sides, value, why, suggestedId, onChange }: { sides: { a: Side; b: Side }; value: string; why: string; suggestedId: string; onChange: (id: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">Which customer should be kept?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {([sides.a, sides.b] as const).map((s) => (
          <label key={s.id} className={cx("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm focus-within:ring-3 focus-within:ring-ring/50", value === s.id ? "border-primary bg-accent" : "border-border bg-card")}>
            <input type="radio" name="survivor" value={s.id} checked={value === s.id} onChange={() => onChange(s.id)} className="mt-0.5 accent-[var(--primary)]" />
            <span>
              <span className="font-medium">Keep {s.first}</span> <span className="text-xs text-muted-foreground">{s.code}</span>
              {s.id === suggestedId && <span className="block text-xs text-muted-foreground">Suggested. {why}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MatchMark({ match }: { match: CompareRow["match"] }) {
  if (match === "same") return <span className="inline-flex items-center gap-1 text-xs"><Check className="size-3 text-success" aria-hidden />Match</span>;
  if (match === "different") return <span className="inline-flex items-center gap-1 text-xs font-medium"><CircleAlert className="size-3 text-warning" aria-hidden />Differs</span>;
  return <span className="text-xs text-muted-foreground">Missing on one side</span>;
}

export function ComparisonTable({
  rows, sides, revealed, onReveal, onHide, busyKey,
}: {
  rows: CompareRow[];
  sides: { a: Side; b: Side };
  revealed: Record<string, string | null>;
  onReveal: (side: "a" | "b", field: SensitiveField) => void;
  onHide: (side: "a" | "b", field: SensitiveField) => void;
  busyKey?: string | null;
}) {
  const cell = (row: CompareRow, side: "a" | "b") => {
    const text = side === "a" ? row.a : row.b;
    if (!row.sensitive || text === "Not provided") return <span>{text}</span>;
    const key = `${side}:${row.key}`;
    const shown = key in revealed;
    const who = side === "a" ? sides.a.first : sides.b.first;
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={shown ? "font-mono" : ""}>{shown ? (revealed[key] ?? "Not provided") : text}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busyKey === key}
          aria-label={`${shown ? "Hide" : "Show"} ${row.label.toLowerCase()} for ${who}`}
          onClick={() => (shown ? onHide(side, row.key as SensitiveField) : onReveal(side, row.key as SensitiveField))}
        >
          {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {shown ? "Hide" : "Show"}
        </Button>
      </span>
    );
  };
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">Side by side comparison of the two customers. Rows that differ are marked.</caption>
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Detail</th>
            <th scope="col" className="px-3 py-2 font-medium">{sides.a.first} <span className="font-normal">{sides.a.code}</span></th>
            <th scope="col" className="px-3 py-2 font-medium">{sides.b.first} <span className="font-normal">{sides.b.code}</span></th>
            <th scope="col" className="w-36 px-3 py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={cx("border-t", row.match === "different" && styles.diff)} data-match={row.match}>
              <th scope="row" className="px-3 py-2 text-left font-medium">{row.label}</th>
              <td className="px-3 py-2">{cell(row, "a")}</td>
              <td className="px-3 py-2">{cell(row, "b")}</td>
              <td className="px-3 py-2"><MatchMark match={row.match} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlanPreview({ plan, survivor, duplicate }: { plan: MergePlan; survivor: string; duplicate: string }) {
  if (plan.blocked) {
    return (
      <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p><span className="font-semibold">This merge is blocked.</span> {plan.blocked}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3 text-sm sm:grid-cols-2">
      <div>
        <h3 className="font-semibold">Moves to {survivor}</h3>
        {plan.moves.length === 0 ? <p className="text-muted-foreground">Nothing to move: {duplicate} has no history yet.</p> : (
          <ul className="mt-1 space-y-0.5">{plan.moves.map((m) => <li key={m.key} className="flex justify-between gap-2"><span>{m.label}</span><span className="tabular-nums text-muted-foreground">{m.count}</span></li>)}</ul>
        )}
      </div>
      <div>
        <h3 className="font-semibold">Stays on the archived {duplicate}</h3>
        {plan.stays.length === 0 ? <p className="text-muted-foreground">Nothing is left behind.</p> : (
          <ul className="mt-1 space-y-0.5">{plan.stays.map((m) => <li key={m.key} className="flex justify-between gap-2"><span>{m.label}</span><span className="tabular-nums text-muted-foreground">{m.count}</span></li>)}</ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{duplicate} is archived, not deleted. Its name, mobile, email and notes are not copied to {survivor}.</p>
      </div>
    </div>
  );
}
