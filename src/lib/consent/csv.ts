export const CSV_HEADER = ["clientCode", "purpose", "channel", "status", "source", "noticeVersion", "capturedAt", "expiresAt"] as const;

export type CsvRow = {
  clientCode: string;
  purpose: string;
  channel: string | null;
  status: string;
  source: string;
  noticeVersion: string | null;
  capturedAt: Date;
  expiresAt: Date | null;
};

function cell(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; // spreadsheet formula injection
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Built field by field from named columns, so nothing else on a row (names, reasons, actor ids) can leak into the export. */
export function consentCsv(rows: readonly CsvRow[]): string {
  const lines = rows.map((r) =>
    [r.clientCode, r.purpose, r.channel, r.status, r.source, r.noticeVersion, r.capturedAt.toISOString(), r.expiresAt?.toISOString() ?? null].map(cell).join(","),
  );
  return [CSV_HEADER.map(cell).join(","), ...lines].join("\n");
}
