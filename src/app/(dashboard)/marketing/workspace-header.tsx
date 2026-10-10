import Link from "next/link";

import type { AdChannel } from "@/lib/marketing/channels";
import type { DateRange } from "@/lib/marketing/view-model";
import { TABS, workspaceHref, type TabKey } from "@/lib/marketing/workspace-params";

import styles from "./marketing.module.css";
import { RangeControl } from "./range-control";

/** The fixed header: title, the four section tabs and (for the ad tabs) the date range. Stays put while the panel below changes. */
export function WorkspaceHeader({ tab, social, range, today, channel }: { tab: TabKey; social: boolean; range: DateRange | null; today: string; channel: AdChannel | "all" }) {
  const tabs = TABS({ social });
  return (
    <header className={styles.head}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Marketing</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">What your ads cost and what they bring in, plus post drafts. Read-only for ad platforms; nothing is ever published for you.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Marketing sections" className={styles.tabs}>
          {tabs.map((t) => (
            <Link key={t.key} href={workspaceHref({ tab: t.key, range: range ?? undefined, channel: t.key === "campaigns" ? channel : undefined })} scroll={false} aria-current={t.key === tab ? "page" : undefined} className={styles.tab}>
              {t.label}
            </Link>
          ))}
        </nav>
        {range && <RangeControl range={range} today={today} tab={tab} channel={channel} />}
      </div>
    </header>
  );
}
