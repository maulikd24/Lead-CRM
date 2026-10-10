import { notFound } from "next/navigation";

import { requireNativePartnerWorkspace } from "@/lib/partners/access";
import { prisma } from "@/lib/db/prisma";
import { prepareStatementExport } from "@/lib/partners/native/export";
import { createNativePort, type NativeDb } from "@/lib/partners/native/queries";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** GET /partners/statements/<partner>/export?run=<run id | open>: the statement as a CSV file. Authorised exactly like the page, and audited before any data is sent. */
export async function GET(req: Request, { params }: { params: Promise<{ partnerId: string }> }) {
  const access = await requireNativePartnerWorkspace();
  const { partnerId } = await params;
  const run = new URL(req.url).searchParams.get("run") ?? "open";
  if (!ID.test(partnerId) || !ID.test(run)) notFound();

  const port = createNativePort(prisma as unknown as NativeDb, access.scope);
  const result = await prepareStatementExport(
    { loadStatement: (p, r) => port.getStatement(p, r), audit: (data) => prisma.auditLog.create({ data }) },
    { userId: access.session.user.id, role: access.role, partnerId, run, format: "csv" },
  );
  if (result.kind === "not_found") return new Response("Not found", { status: 404 });
  return new Response(result.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.filename}"`,
      "cache-control": "no-store",
    },
  });
}
