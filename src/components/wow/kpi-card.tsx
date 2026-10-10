import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CountUp } from "@/components/workspace/count-up";
import { motion } from "@/components/workspace/motion-classes";
import { Skeleton } from "@/components/workspace/skeleton";
import { cn } from "@/lib/utils";

import { AreaSparkline } from "./sparkline";
import styles from "./wow.module.css";
import type { Delta } from "./wow-logic";

export type KpiTone = "default" | "success" | "warning" | "destructive";

/** "up is good" for most figures; for overdue, pending and cost figures a fall is the good news. */
export type GoodWhen = "up" | "down";

/** How a delta reads: "+12%" / "-8%" / "0%", and whether it is good news. Pure, so it is tested. */
export function deltaView(delta: Delta, goodWhen: GoodWhen = "up"): { text: string; good: boolean | null; sr: string } {
  const sign = delta.pct > 0 ? "+" : "";
  const text = `${sign}${delta.pct}%`;
  const good = delta.direction === "flat" ? null : delta.direction === goodWhen;
  const word = delta.direction === "flat" ? "unchanged" : delta.direction === "up" ? "up" : "down";
  return { text, good, sr: `${word} ${Math.abs(delta.pct)} percent` };
}

export function DeltaChip({ delta, goodWhen = "up", label = "vs last period" }: { delta: Delta; goodWhen?: GoodWhen; label?: string }) {
  const v = deltaView(delta, goodWhen);
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  return (
    <>
      <span className={styles.delta} data-good={v.good === null ? undefined : String(v.good)} title={label}>
        <Icon aria-hidden />
        <span aria-hidden>{v.text}</span>
        <span className="sr-only">{`${v.sr} ${label}`}</span>
      </span>
      <span className={styles.vs} aria-hidden>{label}</span>
    </>
  );
}

type Value =
  | { value: number | null; prefix?: string; suffix?: string; decimals?: number; text?: never }
  | { text: string; value?: never; prefix?: never; suffix?: never; decimals?: never };

export type KpiCardProps = Value & {
  label: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  /** Percentage against the previous period. Leave out when there is no earlier period: nothing is invented. */
  delta?: Delta | null;
  goodWhen?: GoodWhen;
  /** What the delta is measured against, e.g. "vs last 7 days". */
  deltaLabel?: string;
  /** Real daily history of this same figure (oldest first). Fewer than two points, or all zeros: no sparkline. */
  series?: readonly number[] | null;
  seriesLabel?: string;
  hint?: ReactNode;
  href?: string;
  index?: number;
};

/**
 * A key figure: a small tinted icon chip, a large tabular number that counts up once, a green or red delta against the last
 * period and a soft area sparkline from the same figure's real history. 14px radius, hairline border, hover lift.
 * Renders an <li>: put it inside <KpiStrip> (or any <ul>).
 */
export function KpiCard({ label, icon: Icon, tone = "default", delta, goodWhen = "up", deltaLabel = "vs last period", series, seriesLabel, hint, href, index = 0, ...v }: KpiCardProps) {
  const number = "text" in v && v.text !== undefined ? v.text : <CountUp value={v.value ?? null} prefix={v.prefix} suffix={v.suffix} decimals={v.decimals} label={label} />;
  const sparkTone = delta && delta.direction === "down" && goodWhen === "up" ? "down" : "up";
  const body = (
    <div className={cn(styles.kpiCard, motion.enter)} style={{ ["--i" as string]: index }}>
      <div className={styles.kpiTop}>
        <p className={styles.kpiLabel}>{label}</p>
        {Icon && (
          <span className={styles.chip} data-tone={tone === "default" ? undefined : tone} aria-hidden>
            <Icon />
          </span>
        )}
      </div>
      <div className={styles.kpiBody}>
        <div className={styles.kpiNumber} data-tone={tone === "default" ? undefined : tone}>
          {number}
        </div>
        <AreaSparkline values={series} label={seriesLabel} tone={sparkTone} className="min-w-0 shrink" />
      </div>
      {(delta || hint) && (
        <div className={styles.kpiFoot}>
          {delta ? <DeltaChip delta={delta} goodWhen={goodWhen} label={deltaLabel} /> : null}
          {!delta && hint ? <span className={styles.footText}>{hint}</span> : null}
        </div>
      )}
    </div>
  );
  return (
    <li className="min-w-[9.25rem] flex-none lg:min-w-0">
      {href ? (
        <Link href={href} className={styles.kpiLink}>
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/** A loading card of the same size, so nothing jumps when the numbers arrive. */
export function KpiCardSkeleton() {
  return (
    <li className="min-w-[9.25rem] flex-none lg:min-w-0">
      <Skeleton className="h-[6.5rem] w-full rounded-[14px]" />
    </li>
  );
}
