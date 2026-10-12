import type { IdentityCoverage as Coverage } from "@/lib/integrations/clevertap/select-batch";

const fmt = (n: number) => n.toLocaleString("en-IN");

/** Read-only counts for the CleverTap card: who the scheduled push can reach, and who it skips and why. */
export function IdentityCoverage({ coverage }: { coverage: Coverage }) {
  const rows: { label: string; value: number }[] = [
    { label: "Ready to sync", value: coverage.eligible },
    { label: "Skipped: no app id", value: coverage.noAppId },
    { label: "Skipped: more than one app id", value: coverage.multipleAppIds },
  ];
  return (
    <div role="group" aria-label="Customers by app id" className="rounded-md border p-3 text-xs">
      <dl className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-2">
            <dt>{r.label}</dt>
            <dd className="tabular-nums text-muted-foreground">{fmt(r.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-muted-foreground">
        Active customers with an email or mobile. A customer without exactly one app user id is never written to CleverTap, so it is never picked for a batch.
      </p>
    </div>
  );
}
