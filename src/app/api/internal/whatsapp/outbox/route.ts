import { NextResponse } from "next/server";

import { verifyWorkerRequest } from "@/lib/whatsapp/worker-auth";
import { claimOutbox } from "@/lib/whatsapp/outbox";

export async function GET(request: Request) {
  if (!verifyWorkerRequest(request, "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sessionIds = (url.searchParams.get("sessionIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 20);

  const items = await claimOutbox(sessionIds, limit);
  return NextResponse.json({ items });
}
