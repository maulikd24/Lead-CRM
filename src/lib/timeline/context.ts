import { safeLine } from "@/lib/ai/summaries/redact";

import type { TimelineItem } from "./model";

/**
 * The "recent activity" line of the AI client summary, from the canonical timeline. Same shape as the original line (`date kind – text`, newest first,
 * `|` separated) so the prompt does not change; the content now spans every source, and every free-text value still goes through safeLine().
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function recentActivityLine(items: readonly TimelineItem[], limit = 8): string {
  const rows = items.slice(0, limit).map((i) => `${day(i.at)} ${i.kind}${i.title ? ` – ${safeLine(i.detail ? `${i.title}: ${i.detail}` : i.title, 100)}` : ""}`);
  return rows.length ? rows.join(" | ") : "none";
}
