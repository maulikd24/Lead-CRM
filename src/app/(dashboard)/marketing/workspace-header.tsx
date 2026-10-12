import type { AdChannel } from "@/lib/marketing/channels";
import type { DateRange } from "@/lib/marketing/view-model";
import { WorkspaceTabs } from "@/components/workspace";
import { TABS, workspaceHref, type TabKey } from "@/lib/marketing/workspace-params";

/** The fixed header: title and one line of context. The tab bar and date range live in the shared workspace shell. */
export function WorkspaceHeading() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div>
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Marketing</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">What your ads cost and what they bring in, plus post drafts. Read-only for ad platforms; nothing is ever published for you.</p>
      </div>
    </div>
  );
}

/** The section tabs. Each is a plain link (`?tab=`), so they work without JS, deep-link and step through browser history. */
export function MarketingTabs({ tab, social, range, channel }: { tab: TabKey; social: boolean; range: DateRange | null; channel: AdChannel | "all" }) {
  const tabs = TABS({ social }).map((t) => ({ key: t.key, label: t.label, href: workspaceHref({ tab: t.key, range: range ?? undefined, channel: t.key === "campaigns" ? channel : undefined }) }));
  return <WorkspaceTabs tabs={tabs} active={tab} idPrefix="mkt" label="Marketing sections" />;
}
