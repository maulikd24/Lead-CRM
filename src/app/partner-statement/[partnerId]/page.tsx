import { notFound } from "next/navigation";

import { PrintableStatement } from "@/components/partners/native/print-document";
import { requireNativePartnerWorkspace } from "@/lib/partners/access";
import { prisma } from "@/lib/db/prisma";
import { prepareStatementExport } from "@/lib/partners/native/export";
import { createNativePort, type NativeDb } from "@/lib/partners/native/queries";
import { buildStatementVM } from "@/lib/partners/native/view-models";
import { parseNativeQuery } from "@/lib/partners/native/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commission statement", robots: { index: false, follow: false } };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The print-friendly statement: every line, no app chrome, so it prints on A4 or saves as a PDF. It lives outside the dashboard
 * layout on purpose (that layout pins the page to the screen height, which would clip a print). Same gate and same scope as
 * the workspace; opening it is an export and is audited.
 */
export default async function PrintStatementPage({ params, searchParams }: { params: Promise<{ partnerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireNativePartnerWorkspace();
  const { partnerId } = await params;
  const run = parseNativeQuery(await searchParams).run ?? "open";
  if (!ID.test(partnerId)) notFound();

  const port = createNativePort(prisma as unknown as NativeDb, access.scope);
  const result = await prepareStatementExport(
    { loadStatement: (p, r) => port.getStatement(p, r), audit: (data) => prisma.auditLog.create({ data }) },
    { userId: access.session.user.id, role: access.role, partnerId, run, format: "print" },
  );
  if (result.kind === "not_found") notFound();
  return <PrintableStatement vm={buildStatementVM(result.data, { all: true })} generatedOn={result.generatedOn} />;
}
