import { Badge } from "@/components/ui/badge";

export type Chip = { label: string; variant: "success" | "warning" | "outline" | "secondary" | "destructive" };

/** The right edge of a row in a master list: an amount and/or status chips. Plain markup, so it can be passed from a server component. */
export function Trailing({ amount, chips }: { amount?: string; chips?: Chip[] }) {
  if (!amount && !(chips && chips.length)) return null;
  return (
    <span className="flex flex-col items-end gap-1 text-right text-xs">
      {amount && <span className="font-medium tabular-nums">{amount}</span>}
      {chips?.map((c) => (
        <Badge key={c.label} variant={c.variant}>
          {c.label}
        </Badge>
      ))}
    </span>
  );
}
