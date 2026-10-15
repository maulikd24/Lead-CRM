import type { ReactNode } from "react";

import styles from "./wow.module.css";

/**
 * Key figures with a hierarchy instead of eight equal tiles: ONE lead figure (large) with up to two supporting cards beside it in
 * the lead row, then a compact one-line row for the rest. Each child is a <KpiCard> (`size="lead"`, default, or `size="compact"`).
 * On a phone the compact row swipes sideways so the strip stays a glance.
 */
export function KpiLeadStrip({ lead, support, compact, label = "Key figures" }: { lead: ReactNode; support?: ReactNode; compact?: ReactNode; label?: string }) {
  return (
    <div className={styles.leadStrip} role="group" aria-label={label}>
      <ul className={styles.leadRow} aria-label={`${label}, headline`}>
        {lead}
        {support}
      </ul>
      {compact && (
        <ul className={styles.compactRow} aria-label={`${label}, more`} tabIndex={0}>
          {compact}
        </ul>
      )}
    </div>
  );
}
