import { NextResponse } from "next/server";
import { Pool } from "pg";

import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/config";
import { logExport } from "@/lib/activity/log-user-event";
import { ImportError, runImport } from "@/lib/data-export/import";

// Loading a large export can take a while; the zip is read into memory and nothing is stored once the request ends.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_BYTES = 500 * 1024 * 1024;
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST multipart: `file` (the export zip), `mode` = "preview" | "import", and for "import" `confirm` = "IMPORT".
 * Preview checks the file against this database and writes nothing; import is all-or-nothing.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return respond({ error: "Sign in first" }, 401);
  if (session.user.role !== "ADMIN") return respond({ error: "Only Admins can import data" }, 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return respond({ error: "The upload could not be read. If the file is large, your hosting may limit upload size — use the command-line importer instead." }, 400);
  }
  const file = form.get("file");
  const mode = form.get("mode");
  if (!(file instanceof File)) return respond({ error: "Choose the export zip first" }, 400);
  if (file.size > MAX_BYTES) return respond({ error: "This file is over 500 MB — use the command-line importer instead." }, 413);
  if (mode !== "preview" && mode !== "import") return respond({ error: "Unknown mode" }, 400);
  if (mode === "import" && form.get("confirm") !== "IMPORT") return respond({ error: "Type IMPORT to confirm" }, 400);

  const url = process.env.DATABASE_URL;
  if (!url) return respond({ error: "No database configured" }, 500);

  const pool = new Pool({ connectionString: url.replace(/^prisma\+postgres/, "postgres"), max: 1 });
  try {
    const report = await runImport({ bytes: new Uint8Array(await file.arrayBuffer()), pool, dryRun: mode === "preview" });
    if (mode === "import") {
      await prisma.auditLog.create({
        data: {
          userId: session.user.id,
          entity: "DataImport",
          entityId: file.name.slice(0, 100),
          action: "data_import_completed",
          newValue: { exportedAt: report.exportedAt, usersCreated: report.usersToCreate, rows: Object.fromEntries(report.tables.map((t) => [t.table, t.rows])) },
        },
      });
      void logExport(session.user, "/api/data-import", "Imported a data export");
    }
    return respond(report);
  } catch (error) {
    if (error instanceof ImportError) return respond({ error: error.message, details: error.details }, 422);
    console.error("Data import failed", error);
    return respond({ error: "The import failed and was rolled back. Nothing was changed.", details: [error instanceof Error ? error.message : String(error)] }, 500);
  } finally {
    await pool.end();
  }
}
