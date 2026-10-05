import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

export const MAX_LEAD_BODY_BYTES = 64_000;

/** Reads the raw body once, refusing anything over the cap (checked on both the header and the actual text). */
export async function readCappedBody(request: Request, max = MAX_LEAD_BODY_BYTES): Promise<{ ok: true; raw: string } | { ok: false; response: NextResponse }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) return { ok: false, response: NextResponse.json({ error: "Payload too large" }, { status: 413 }) };
  const raw = await request.text();
  if (raw.length > max) return { ok: false, response: NextResponse.json({ error: "Payload too large" }, { status: 413 }) };
  return { ok: true, raw };
}

export function parseJsonBody(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return undefined;
  }
}

/** A short, stable idempotency key for submissions that carry no id of their own. */
export function hashKey(...parts: (string | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex").slice(0, 32);
}
