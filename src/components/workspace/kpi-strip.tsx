import type { ReactNode } from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { motion } from "./motion-classes";
import styles from "./workspace.module.css";

const TONE = { default: "", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;

/**
 * A single row of key figures that stays in view above the tabs (a "command" layout header). On a phone it is a swipeable
 * strip; from 1024px the tiles share the row and wrap to a second one only when they must. Put <KpiTile>s inside.
 */
export function KpiStrip({ children, label = "Key figures", className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn(styles.kpis, className)}>
      {children}
    </ul>
  );
}

/**
 * One compact figure: label, value (text or a <CountUp>), optional hint and accessory (a sparkline). With `href` the whole
 * tile is a link. `index` staggers the entrance. Hover lift only when it is a link.
 */
export function KpiTile({ label, children, hint, tone = "default", href, accessory, index = 0 }: { label: string; children: ReactNode; hint?: ReactNode; tone?: keyof typeof TONE; href?: string; accessory?: ReactNode; index?: number }) {
  const body = (
    <CardContent className="flex flex-col gap-0.5 px-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div className={cn("font-heading text-xl font-semibold leading-tight tabular-nums", TONE[tone])}>{children}</div>
        {accessory}
      </div>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </CardContent>
  );
  return (
    <li className={styles.kpi}>
      <Card size="sm" className={cn(motion.enter, href && motion.lift, "gap-0 py-2")} style={{ ["--i" as string]: index }}>
        {href ? (
          <Link href={href} className="block rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {body}
          </Link>
        ) : (
          body
        )}
      </Card>
    </li>
  );
}
