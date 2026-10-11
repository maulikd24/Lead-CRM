/**
 * An approved content brief: what a post or ad variant is for. The content engine only drafts from a brief a person has approved.
 */

export const CONTENT_CHANNELS = {
  ad: { label: "Ad variant", maxChars: 500 },
  post: { label: "Social post", maxChars: 800 },
} as const;

export type ContentChannel = keyof typeof CONTENT_CHANNELS;

export type ContentBrief = {
  briefId: string;
  product: string;
  audience: string;
  /** The one promise the piece makes. Educational and calm; never a return, a guarantee or advice. */
  promise: string;
  channel: ContentChannel;
  /** Must be true. A brief nobody approved is refused before any model is called. */
  approved: boolean;
};

export type BriefProblem = "unknown_channel" | "empty_field" | "not_approved";

export function briefProblems(brief: ContentBrief): BriefProblem[] {
  const problems: BriefProblem[] = [];
  if (!Object.prototype.hasOwnProperty.call(CONTENT_CHANNELS, brief.channel)) problems.push("unknown_channel");
  if (!brief.product?.trim() || !brief.audience?.trim() || !brief.promise?.trim() || !brief.briefId?.trim()) problems.push("empty_field");
  if (brief.approved !== true) problems.push("not_approved");
  return problems;
}
