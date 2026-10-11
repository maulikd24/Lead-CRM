import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { collectSystemStatus } from "@/lib/system/status";
import { statusDeps } from "@/lib/system/status-wiring";

// Admin only. Names and counts, never a secret value (see src/lib/system/status.ts). The public /api/health is separate and unchanged.
export const dynamic = "force-dynamic";

export async function GET() {
  await requireRole(["ADMIN"]);
  const status = await collectSystemStatus(statusDeps, process.env);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
