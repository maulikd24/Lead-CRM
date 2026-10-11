import type { Role } from "@/generated/prisma/client";

import { getCustomerTimeline } from "./reader";
import type { TimelineItem } from "./model";

/** The Customer 360 timeline loader over the canonical reader (CUSTOMER_TIMELINE_V2). Same shape the original loader returns: events newest first and an "older not shown" flag. */
export async function loadCanonicalTimeline(clientId: string, viewer: { id: string; role: Role }): Promise<{ events: TimelineItem[]; olderNotShown: boolean }> {
  const res = await getCustomerTimeline(clientId, { viewer, limit: 200 });
  if (!res.ok) throw new Error(`timeline ${res.reason}`);
  return { events: res.items, olderNotShown: res.olderNotShown };
}
