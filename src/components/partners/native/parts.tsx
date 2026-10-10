import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CountUp, motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { bankText } from "@/lib/partners/native/view-models";
import { InrCountUp } from "../inr-count-up";

export const enter = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;

export const TONE_TEXT = { default: "", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;

/** A headline figure that counts up once. Rupees or a plain number; the hint says what is behind it. */
export function Tile({ label, value, format, tone = "default", hint, index = 0, whole = false }: { label: string; value: number | null; format: "inr" | "number"; tone?: keyof typeof TONE_TEXT; hint?: string; index?: number; whole?: boolean }) {
  return (
    <Card size="sm" className={cn(motion.enter, motion.lift)} style={enter(index)}>
      <CardContent className="flex flex-col gap-1 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("font-heading text-xl font-semibold tabular-nums sm:text-2xl", TONE_TEXT[tone])}>
          {format === "inr" ? <InrCountUp value={whole && value !== null ? Math.round(value) : value} label={label} /> : <CountUp value={value} label={label} />}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const BADGE = { default: "secondary", success: "success", warning: "warning", destructive: "destructive" } as const;

/** Bank state as a badge plus, when known, the last four digits and nothing more. */
export function BankBadge({ bank }: { bank: ReturnType<typeof bankText> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={BADGE[bank.tone]}>{bank.label}</Badge>
      {bank.tail && <span className="font-mono text-xs text-muted-foreground" aria-label={`Account ending ${bank.tail.slice(-4)}`}>{bank.tail}</span>}
    </span>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> {children}
    </Link>
  );
}

/** A small caption under a table or heading. */
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
