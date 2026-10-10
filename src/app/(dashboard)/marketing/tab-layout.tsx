import type { ReactNode } from "react";

import styles from "./marketing.module.css";

/** The panel beside its rail. The panel is keyed by tab, so it remounts and softly cross-fades in when the tab changes. */
export function TabLayout({ tab, main, rail }: { tab: string; main: ReactNode; rail: ReactNode }) {
  return (
    <div className={styles.body}>
      <section key={tab} aria-label={`${tab} section`} className={`${styles.main} ${styles.panel}`}>
        <div className="flex flex-col gap-3">{main}</div>
      </section>
      {rail}
    </div>
  );
}
