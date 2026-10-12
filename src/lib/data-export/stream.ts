import { createHash } from "node:crypto";

import { Zip, ZipDeflate, strToU8 } from "fflate";

import { prisma } from "@/lib/db/prisma";
import { toCsv } from "./csv";
import { EXCLUDED_BY_DESIGN, EXPORT_SCHEMA_VERSION, EXPORT_TABLES } from "./tables";

const PAGE_SIZE = 1000;

type Row = Record<string, unknown>;

export type ExportMeta = {
  exportId: string;
  exportedAt: Date;
  requestedBy: { name: string; email: string };
  approvedBy: { name: string; email: string } | null;
  reason: string;
};

export type ExportResult = { rowCounts: Record<string, number>; files: Record<string, { rows: number; sha256: string }> };

const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

const README = `SUPPORTIFY DATA EXPORT
======================

data/<Table>.ndjson   One JSON object per line, every column, original IDs. This is the migration format.
                      Dates are ISO-8601, money is a string (no rounding), JSON columns are kept as JSON.
readable/clients.csv          One row per client — open in Excel / Sheets.
readable/client-timeline.csv  Notes, calls, WhatsApp/SMS, support tickets, tasks, AI insights, outcomes and call/chat
                              transcripts for every client, with client code, name, mobile and email on each row.
                              Sort by client code and "when" to read a client's story.
manifest.json         Row counts and a SHA-256 for every file, who requested and approved the export, and what is NOT included.

To load this into a new Supportify installation use:  npm run import:data -- <this zip>   (run it on the new server).

NOT included: passwords and security counters, device and push tokens, integration credentials, the audit trail and user
activity log, journeys, templates, partner/commission/earnings data, and the uploaded document files themselves (Supportify
stores each document's status and remarks, not the file). See manifest.json "excluded" for the full list.
Treat this file as highly confidential: it contains PAN numbers, phone numbers, emails and conversations.
`;

/** Reads a whole table (or query) in keyset-paged batches so memory stays flat however large it is. */
async function* pages(sql: string, pk: string): AsyncGenerator<Row[]> {
  let cursor = "";
  for (;;) {
    const rows = (await prisma.$queryRawUnsafe(sql, cursor, PAGE_SIZE)) as Row[];
    if (rows.length === 0) return;
    yield rows;
    cursor = String(rows[rows.length - 1][pk]);
    if (rows.length < PAGE_SIZE) return;
  }
}

const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

const CLIENT_JOIN = `JOIN "Client" c ON c.id = x."clientId"`;
const clientCols = `c."clientCode" AS "clientCode", c.name AS "clientName", c.mobile AS "mobile", c.email AS "email"`;

/** Each source of "things that happened with a client", flattened into the same readable columns. */
const TIMELINE: { kind: string; sql: string; map: (r: Row) => Row }[] = [
  {
    kind: "Activity",
    sql: `SELECT x.id, x."createdAt", x.type, x.payload, u.name AS author, ${clientCols} FROM "Activity" x ${CLIENT_JOIN} LEFT JOIN "User" u ON u.id = x."userId" WHERE x.id > $1 ORDER BY x.id LIMIT $2`,
    map: (r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      return { when: r.createdAt, kind: `Activity: ${r.type}`, author: r.author, summary: p.message ?? p.subject ?? "", text: p.description ?? "", details: r.payload };
    },
  },
  {
    kind: "Message",
    sql: `SELECT x.id, x."createdAt", x."sentAt", x.channel, x.direction, x.body, x.status, x.origin, u.name AS author, ${clientCols} FROM "Message" x ${CLIENT_JOIN} LEFT JOIN "User" u ON u.id = x."senderUserId" WHERE x.id > $1 ORDER BY x.id LIMIT $2`,
    map: (r) => ({ when: r.sentAt ?? r.createdAt, kind: `Message: ${r.channel} ${String(r.direction).toLowerCase()}`, author: r.author ?? (r.direction === "INBOUND" ? "Customer" : ""), summary: r.status, text: r.body }),
  },
  {
    kind: "SupportTicket",
    sql: `SELECT x.id, x."createdAt", x."ticketCreatedAt", x.provider, x."externalId", x.subject, x.status, x.priority, x.channel, ${clientCols} FROM "SupportTicket" x ${CLIENT_JOIN} WHERE x.id > $1 ORDER BY x.id LIMIT $2`,
    map: (r) => ({ when: r.ticketCreatedAt ?? r.createdAt, kind: `Support ticket: ${r.channel ?? r.provider}`, author: "", summary: `${r.provider} #${r.externalId} — ${r.status ?? ""}`, text: r.subject }),
  },
  {
    kind: "Task",
    sql: `SELECT x.id, x."createdAt", x.title, x.status, x."dueAt", x.category, u.name AS author, ${clientCols} FROM "Task" x ${CLIENT_JOIN} LEFT JOIN "User" u ON u.id = x."assignedToId" WHERE x.id > $1 ORDER BY x.id LIMIT $2`,
    map: (r) => ({ when: r.createdAt, kind: "Task", author: r.author, summary: `${r.status} — due ${r.dueAt instanceof Date ? r.dueAt.toISOString() : r.dueAt}`, text: r.title }),
  },
  {
    kind: "ConversationInsight",
    sql: `SELECT x.id, x."occurredAt", x.kind, x."assetClass", x.text, x.status, x.severity, x."sourceType", ${clientCols} FROM "ConversationInsight" x ${CLIENT_JOIN} WHERE x.id > $1 ORDER BY x.id LIMIT $2`,
    map: (r) => ({ when: r.occurredAt, kind: `Insight: ${String(r.kind).toLowerCase().replace(/_/g, " ")}`, author: "AI", summary: [r.assetClass, r.status, r.severity].filter(Boolean).join(" · "), text: r.text }),
  },
  {
    kind: "InteractionOutcome",
    sql: `SELECT x.id, x."createdAt", x.outcome, x.channel, x."assetClass", x.note, x.summary, x."actorType", ${clientCols} FROM "InteractionOutcome" x ${CLIENT_JOIN} WHERE x.id > $1 ORDER BY x.id LIMIT $2`,
    map: (r) => ({ when: r.createdAt, kind: `Outcome: ${String(r.outcome).toLowerCase().replace(/_/g, " ")}`, author: r.actorType, summary: [r.channel, r.assetClass].filter(Boolean).join(" · "), text: [r.note, r.summary].filter(Boolean).join(" — ") }),
  },
  {
    kind: "ConversationReview",
    sql: `SELECT x.id, x."createdAt", x."sourceType", x.transcript, x."sentimentLabel", x."qualityScore", x."recommendationText", ${clientCols} FROM "ConversationReview" x ${CLIENT_JOIN} WHERE x.id > $1 ORDER BY x.id LIMIT $2`,
    map: (r) => ({ when: r.createdAt, kind: `Transcript: ${String(r.sourceType).toLowerCase().replace(/_/g, " ")}`, author: "", summary: `sentiment ${r.sentimentLabel ?? "n/a"} · quality ${r.qualityScore ?? "n/a"}${r.recommendationText ? ` · ${r.recommendationText}` : ""}`, text: r.transcript }),
  },
];

const TIMELINE_COLUMNS = ["clientCode", "clientName", "mobile", "email", "when", "kind", "author", "summary", "text", "details"];

export type ExportStream = { stream: ReadableStream<Uint8Array>; done: Promise<ExportResult> };

/**
 * Builds the zip on the fly and streams it: tables are read in pages, compressed as they go, and nothing is written to disk
 * or object storage. `done` resolves with the row counts once the last byte has been produced.
 */
export function createExportStream(meta: ExportMeta): ExportStream {
  const files: ExportResult["files"] = {};
  let resolveDone!: (r: ExportResult) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<ExportResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {}); // the stream's own error is what the caller sees

  const stream = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        const zip = new Zip((error, chunk, final) => {
          if (error) {
            controller.error(error);
            rejectDone(error);
            return;
          }
          controller.enqueue(chunk);
          if (final) controller.close();
        });

        // Back-pressure: don't read the next page of a table while the client hasn't consumed what we already produced.
        const drained = async () => {
          while ((controller.desiredSize ?? 1) <= 0) await new Promise((r) => setTimeout(r, 15));
        };

        const addFile = async (name: string, produce: (write: (text: string) => Promise<void>) => Promise<number>) => {
          const entry = new ZipDeflate(name, { level: 6 });
          zip.add(entry);
          const hash = createHash("sha256");
          const write = async (text: string) => {
            if (!text) return;
            const bytes = strToU8(text);
            hash.update(bytes);
            entry.push(bytes, false);
            await drained();
          };
          const rows = await produce(write);
          entry.push(new Uint8Array(0), true);
          files[name] = { rows, sha256: hash.digest("hex") };
        };

        try {
          await addFile("README.txt", async (write) => {
            await write(README);
            return 0;
          });

          for (const { table, pk = "id", exclude = [] } of EXPORT_TABLES) {
            await addFile(`data/${table}.ndjson`, async (write) => {
              let count = 0;
              for await (const batch of pages(`SELECT * FROM ${q(table)} WHERE ${q(pk)} > $1 ORDER BY ${q(pk)} LIMIT $2`, pk)) {
                for (const row of batch) for (const column of exclude) delete row[column];
                await write(`${batch.map((row) => JSON.stringify(row, jsonReplacer)).join("\n")}\n`);
                count += batch.length;
              }
              return count;
            });
          }

          await addFile("readable/clients.csv", async (write) => {
            let count = 0;
            let columns: string[] | null = null;
            const sql = `SELECT x.*, u.name AS "assignedToName", s.name AS "stageName" FROM "Client" x LEFT JOIN "User" u ON u.id = x."assignedToId" LEFT JOIN "Stage" s ON s.id = x."currentStageId" WHERE x.id > $1 ORDER BY x.id LIMIT $2`;
            for await (const batch of pages(sql, "id")) {
              const cols = columns ?? (columns = Object.keys(batch[0]));
              await write(toCsv(cols, batch, count === 0));
              count += batch.length;
            }
            if (count === 0) await write(toCsv(["clientCode", "name"], [], true));
            return count;
          });

          await addFile("readable/client-timeline.csv", async (write) => {
            let count = 0;
            await write(toCsv(TIMELINE_COLUMNS, [], true));
            for (const source of TIMELINE) {
              for await (const batch of pages(source.sql, "id")) {
                const rows = batch.map((r) => ({ clientCode: r.clientCode, clientName: r.clientName, mobile: r.mobile, email: r.email, ...source.map(r) }));
                await write(toCsv(TIMELINE_COLUMNS, rows, false));
                count += rows.length;
              }
            }
            return count;
          });

          const rowCounts = Object.fromEntries(EXPORT_TABLES.map((t) => [t.table, files[`data/${t.table}.ndjson`].rows]));
          const manifest = {
            format: "supportify-export",
            schemaVersion: EXPORT_SCHEMA_VERSION,
            exportId: meta.exportId,
            exportedAt: meta.exportedAt.toISOString(),
            requestedBy: meta.requestedBy,
            approvedBy: meta.approvedBy,
            reason: meta.reason,
            tables: EXPORT_TABLES.map((t) => ({ table: t.table, rows: rowCounts[t.table], sha256: files[`data/${t.table}.ndjson`].sha256, excludedColumns: t.exclude ?? [] })),
            readable: { clients: files["readable/clients.csv"], timeline: files["readable/client-timeline.csv"] },
            excluded: EXCLUDED_BY_DESIGN,
          };
          // The manifest is last so it can carry every file's hash; it is not hashed itself.
          const entry = new ZipDeflate("manifest.json", { level: 6 });
          zip.add(entry);
          entry.push(strToU8(JSON.stringify(manifest, null, 2)), true);
          zip.end();
          resolveDone({ rowCounts, files });
        } catch (error) {
          controller.error(error);
          rejectDone(error);
        }
      },
    },
    { highWaterMark: 8 },
  );

  return { stream, done };
}
