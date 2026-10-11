import { NextResponse } from "next/server";

import { verifyWorkerRequest } from "@/lib/whatsapp/worker-auth";
import { outboxResultSchema } from "@/lib/whatsapp/events";
import { completeOutbox } from "@/lib/whatsapp/outbox";
import { jobSpec } from "@/lib/system/job-registry";
import { withRunRecord } from "@/lib/system/with-run-record";

async function handlePost(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = outboxResultSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { id } = await params;
  const outcome = await completeOutbox(id, parsed.data);
  if (!outcome.found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Control plane: records each run (status, duration, error class only) after the response is decided; the handler is unchanged.
export const POST = withRunRecord(jobSpec("webhook:whatsapp-outbox-result")!, handlePost);
