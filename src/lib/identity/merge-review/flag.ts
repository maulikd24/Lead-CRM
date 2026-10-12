/** Duplicate-customer review (/clients/duplicates and its actions) ships dark: on only when NEXT_PUBLIC_MERGE_REVIEW is exactly "1". */
export function mergeReviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_MERGE_REVIEW === "1";
}
