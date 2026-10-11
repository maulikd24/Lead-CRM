import { isAdChannel, type AdChannel } from "./channels";
import type { DateRange } from "./view-model";

/** URL state of the Marketing workspace: which tab, which channel filter, which post view. Pure. */

export type TabKey = "overview" | "campaigns" | "creative" | "impact" | "intel" | "briefs" | "experiments" | "competitors" | "posts" | "reports";
type Params = Record<string, string | string[] | undefined>;

const LABELS: Record<TabKey, string> = { overview: "Overview", campaigns: "Campaigns", creative: "Creative", impact: "Campaign impact", intel: "Insights", briefs: "Briefs", experiments: "Experiments", competitors: "Competitors", posts: "Posts", reports: "Reports" };

type TabOptions = {
  social: boolean;
  /** Campaign impact (NEXT_PUBLIC_ATTRIBUTION). */
  attribution?: boolean;
  /** Creative intelligence, briefs, experiments and competitors (NEXT_PUBLIC_CREATIVE_INTEL and an allowed role). */
  creative?: boolean;
  /** Director reports (DIRECTOR_REPORTS_ENABLED and an allowed role). */
  reports?: boolean;
};
const ORDER: TabKey[] = ["overview", "campaigns", "creative", "impact", "intel", "briefs", "experiments", "competitors", "posts", "reports"];
const CREATIVE_TABS = new Set<TabKey>(["intel", "briefs", "experiments", "competitors"]);

export function TABS(options: TabOptions): { key: TabKey; label: string }[] {
  return ORDER.filter((k) => (k !== "posts" || options.social) && (k !== "impact" || options.attribution === true) && (!CREATIVE_TABS.has(k) || options.creative === true) && (k !== "reports" || options.reports === true)).map((key) => ({ key, label: LABELS[key] }));
}

const single = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

export function parseTab(params: Params, options: TabOptions): TabKey {
  const tab = single(params.tab);
  return TABS(options).some((t) => t.key === tab) ? (tab as TabKey) : "overview";
}

export function parseChannelFilter(params: Params, enabled: readonly AdChannel[]): AdChannel | "all" {
  const channel = single(params.channel);
  return isAdChannel(channel) && enabled.includes(channel) ? channel : "all";
}

export function parseView(params: Params): "board" | "calendar" {
  return single(params.view) === "calendar" ? "calendar" : "board";
}

export function workspaceHref(input: { tab?: TabKey; range?: DateRange; view?: "board" | "calendar"; month?: string; channel?: AdChannel | "all"; post?: string; compare?: boolean; campaign?: string }): string {
  const q: [string, string][] = [];
  if (input.tab && input.tab !== "overview") q.push(["tab", input.tab]);
  if (input.range) {
    if (input.range.preset === "custom") q.push(["from", input.range.from], ["to", input.range.to]);
    else q.push(["range", input.range.preset]);
  }
  if (input.view && input.view !== "board") q.push(["view", input.view]);
  if (input.month) q.push(["month", input.month]);
  if (input.channel && input.channel !== "all") q.push(["channel", input.channel]);
  if (input.post) q.push(["post", input.post]);
  if (input.compare) q.push(["compare", "1"]);
  if (input.campaign) q.push(["campaign", input.campaign]);
  return q.length ? `/marketing?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "/marketing";
}
