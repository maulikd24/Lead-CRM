import { bucketCounts, periodBuckets } from "@/lib/wow/buckets";

/** Activity over the selected range, a bucket per day (or per few days for 90): the real counts behind the Insights chart and sparklines. */
export type InsightsTrend = { labels: string[]; outcomes: number[]; positive: number[]; drafts: number[]; replies: number[] };

export function buildTrend(input: {
  now: Date;
  days: number;
  outcomes: { at: Date; positive: boolean }[];
  drafts: Date[];
  replies: Date[];
}): InsightsTrend {
  const from = new Date(input.now.getTime() - input.days * 86_400_000);
  const { n, bucketMs } = periodBuckets(from, input.now);
  return {
    labels: Array.from({ length: n }, (_, i) => new Date(from.getTime() + i * bucketMs).toLocaleDateString("en-IN", { day: "numeric", month: "short" })),
    outcomes: bucketCounts(input.outcomes.map((o) => o.at), from, bucketMs, n),
    positive: bucketCounts(input.outcomes.filter((o) => o.positive).map((o) => o.at), from, bucketMs, n),
    drafts: bucketCounts(input.drafts, from, bucketMs, n),
    replies: bucketCounts(input.replies, from, bucketMs, n),
  };
}
