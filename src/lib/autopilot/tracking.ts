import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import type { AutopilotSnapshot, Platform } from "./types";

/** Tracking integrity: double counting, missing events and broken offline-conversion imports. Pure. */

export type TrackingFinding = {
  kind: "duplicate_firing" | "missing_event" | "import_broken" | "import_stale" | "import_rejections" | "no_dedup_id";
  severity: "critical" | "high" | "medium";
  platform: Platform;
  subject: string;
  message: string;
  evidence: string[];
};

export type TrackingReport = { available: boolean; findings: TrackingFinding[] };

export function trackingIntegrity(s: AutopilotSnapshot, t: Thresholds = DEFAULT_THRESHOLDS): TrackingReport {
  if (!s.tracking) return { available: false, findings: [] };
  const out: TrackingFinding[] = [];
  const now = Date.parse(s.asOf);
  for (const e of s.tracking.events) {
    if (e.expected && e.fires7d === 0) {
      out.push({ kind: "missing_event", severity: "critical", platform: e.platform, subject: e.name, message: `The "${e.name}" event did not fire on ${e.platform === "meta" ? "Meta" : "Google"} in the last 7 days, so ads cannot learn from it.`, evidence: ["0 fires in 7 days"] });
      continue;
    }
    if (e.fires7d > 0 && e.uniqueIds7d > 0 && e.fires7d / e.uniqueIds7d > t.duplicateRatio) {
      out.push({ kind: "duplicate_firing", severity: "high", platform: e.platform, subject: e.name, message: `"${e.name}" appears to be counted twice: ${e.fires7d} fires for ${e.uniqueIds7d} distinct events in 7 days.`, evidence: [`${e.fires7d} fires`, `${e.uniqueIds7d} distinct ids`, `ratio ${(e.fires7d / e.uniqueIds7d).toFixed(2)}`] });
    }
    if (e.fires7d > 0 && e.withoutId7d / e.fires7d > 0.2) {
      out.push({ kind: "no_dedup_id", severity: "medium", platform: e.platform, subject: e.name, message: `"${e.name}" is often sent without an event id, so the platform cannot remove duplicates.`, evidence: [`${e.withoutId7d} of ${e.fires7d} fires had no id`] });
    }
  }
  for (const o of s.tracking.offlineImports) {
    const who = o.platform === "meta" ? "Meta" : "Google";
    const lastOk = o.lastSuccessAt ? Date.parse(o.lastSuccessAt) : null;
    if (o.sent7d > 0 && o.rejected7d / o.sent7d >= 1) {
      out.push({ kind: "import_broken", severity: "critical", platform: o.platform, subject: `${who} offline conversions`, message: `Every funded-customer upload to ${who} was rejected in the last 7 days.`, evidence: [`${o.rejected7d} of ${o.sent7d} rejected`, ...(o.lastError ? [`last error: ${o.lastError.slice(0, 120)}`] : [])] });
    } else if (o.sent7d > 0 && o.rejected7d / o.sent7d > t.importRejectRate) {
      out.push({ kind: "import_rejections", severity: "high", platform: o.platform, subject: `${who} offline conversions`, message: `${Math.round((o.rejected7d / o.sent7d) * 100)}% of funded-customer uploads to ${who} were rejected in the last 7 days.`, evidence: [`${o.rejected7d} of ${o.sent7d} rejected`, ...(o.lastError ? [`last error: ${o.lastError.slice(0, 120)}`] : [])] });
    }
    if (o.lastAttemptAt && (lastOk === null || (now - lastOk) / 86_400_000 > t.importStaleDays)) {
      out.push({ kind: "import_stale", severity: "high", platform: o.platform, subject: `${who} offline conversions`, message: lastOk === null ? `${who} offline-conversion uploads have been attempted but none has ever succeeded.` : `The last successful ${who} offline-conversion upload was ${Math.floor((now - lastOk) / 86_400_000)} days ago.`, evidence: [o.lastSuccessAt ? `last success ${o.lastSuccessAt.slice(0, 10)}` : "no success on record"] });
    }
  }
  return { available: true, findings: out };
}
