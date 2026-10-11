import { basePrisma as db } from "@/lib/db/prisma";
import { customerEventsEnabled } from "@/lib/events/flag";

import { CHECK_RUNNERS } from "./checks-db";
import { CHECKS, reconcilePlan, type CheckKey, type Finding } from "./model";
import { applyPlan, loadExisting } from "./store-db";

/** The sweep runs at most once an hour (the tick fires every 5 minutes); the throttle marker is a cursor row, so no extra table is needed. */
const MARKER = "job:data-health";
const EVERY_MS = 3_600_000;

/**
 * The data-health sweep: runs every check, then reconciles work items (new findings become items, items whose problem is gone resolve, an
 * acknowledgement survives while the problem persists). Read-only on customer data; only DataHealthItem rows are written. Skipped unless
 * CUSTOMER_EVENTS_ENABLED=1. A check that throws is skipped and its items are left as they were.
 */
export async function runDataHealth(opts: { now?: Date; force?: boolean } = {}): Promise<Record<string, number | boolean>> {
  if (!customerEventsEnabled()) return { skipped: true } as never;
  const now = opts.now ?? new Date();
  if (!opts.force) {
    const marker = await db.eventCursor.findUnique({ where: { consumer: MARKER }, select: { lastRunAt: true } });
    if (marker?.lastRunAt && now.getTime() - marker.lastRunAt.getTime() < EVERY_MS) return { skipped: true, notDue: true } as never;
  }
  const found: Finding[] = [];
  const ran: CheckKey[] = [];
  let failedChecks = 0;
  for (const key of Object.keys(CHECKS) as CheckKey[]) {
    try {
      const r = await CHECK_RUNNERS[key](now);
      found.push(...r.findings);
      ran.push(key);
    } catch {
      failedChecks += 1;
    }
  }
  const existing = await loadExisting(ran);
  const plan = reconcilePlan(existing, found, ran);
  const applied = await applyPlan(plan, found, now);
  await db.eventCursor.upsert({ where: { consumer: MARKER }, create: { consumer: MARKER, lastRunAt: now }, update: { lastRunAt: now } });
  return { checks: ran.length, failedChecks, findings: found.length, created: applied.created, touched: applied.touched, resolved: applied.resolved };
}
