import { NextResponse } from "next/server";

import { verifyWorkerRequest } from "@/lib/whatsapp/worker-auth";
import { workerEventsBodySchema } from "@/lib/whatsapp/events";
import { processWorkerEvent } from "@/lib/whatsapp/ingest";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyWorkerRequest(request, rawBody)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = workerEventsBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  // Sequential on purpose: order within a batch matters (e.g. a message then its ack), and each
  // result is reported back so the worker can retry only the events that errored.
  const results = [];
  for (const event of parsed.data.events) {
    results.push(await processWorkerEvent(event));
  }

  return NextResponse.json({ ok: true, results });
}
