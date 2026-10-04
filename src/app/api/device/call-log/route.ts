import { NextResponse } from "next/server";

import { authenticateDevice } from "@/lib/device/token";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { callLogPayloadSchema, ingestDeviceCalls } from "@/lib/device/ingest-calls";

const MAX_BODY_BYTES = 200_000;

// Called by the Android app's background worker with a per-device Bearer token (no browser session).
// Never logs the request body — it contains the phone's raw call log.
export async function POST(request: Request) {
  // Each phone syncs about every 15 minutes; this only stops token guessing / floods hitting the token lookup.
  const limited = await rateLimit("device:call-log", clientIp(request), { limit: 60, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);

  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = callLogPayloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const result = await ingestDeviceCalls({ id: device.id, userId: device.userId }, device.user, parsed.data);
  return NextResponse.json(result);
}
