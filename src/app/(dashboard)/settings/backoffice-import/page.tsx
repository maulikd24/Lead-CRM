import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { backofficeImportDir, backofficeImportEnabled } from "@/lib/backoffice-import/flag";
import { loadMapping, loadRecentRuns } from "@/lib/backoffice-import/prisma-deps";
import { ImportView } from "./import-view";

export default async function BackOfficeImportPage() {
  await requireRole(["ADMIN"]);
  if (!backofficeImportEnabled()) notFound();

  const [mapping, runs] = await Promise.all([loadMapping(), loadRecentRuns(10)]);
  const hour = Number(process.env.BACKOFFICE_IMPORT_HOUR_UTC);
  return <ImportView mapping={mapping} runs={runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null }))} directoryConfigured={backofficeImportDir() !== null} nightlyHourUtc={Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 21} />;
}
