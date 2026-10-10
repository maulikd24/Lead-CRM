import { isAdChannel, type AdChannel } from "./channels";
import type { DateRange } from "./view-model";

/** URL state of the Marketing workspace: which tab, which channel filter, which post view. Pure. */

export type TabKey = "overview" | "campaigns" | "creative" | "posts";
type Params = Record<string, string | string[] | undefined>;

const LABELS: Record<TabKey, string> = { overview: "Overview", campaigns: "Campaigns", creative: "Creative", posts: "Posts" };

export function TABS(options: { social: boolean }): { key: TabKey; label: string }[] {
  return (["overview", "campaigns", "creative", "posts"] as const).filter((k) => k !== "posts" || options.social).map((key) => ({ key, label: LABELS[key] }));
}

const single = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

export function parseTab(params: Params, options: { social: boolean }): TabKey {
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

export function workspaceHref(input: { tab?: TabKey; range?: DateRange; view?: "board" | "calendar"; month?: string; channel?: AdChannel | "all"; post?: string }): string {
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
  return q.length ? `/marketing?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "/marketing";
}
