/** Strict, dependency-free CSV reader (RFC 4180 subset: quotes, escaped quotes, embedded newlines, CRLF/LF, BOM).
 * Limits are enforced before and while parsing. Failures carry a short code only: never file content. */

export const CSV_LIMITS = {
  maxBytes: 5_000_000,
  maxRows: 20_000,
  maxColumns: 60,
  maxFieldLength: 500,
} as const;

export type CsvLimits = { maxBytes: number; maxRows: number; maxColumns: number; maxFieldLength: number };
export type CsvRow = { /** 1-based physical line the record starts on (header is line 1). */ line: number; cells: string[]; /** More cells than header columns. */ tooWide?: boolean };
export type CsvFailure = "EMPTY" | "TOO_LARGE" | "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS" | "FIELD_TOO_LONG" | "DUPLICATE_HEADER" | "UNTERMINATED_QUOTE";
export type CsvResult = { ok: true; header: string[]; rows: CsvRow[] } | { ok: false; code: CsvFailure };

export function parseCsv(input: string, limits: CsvLimits = CSV_LIMITS): CsvResult {
  if (Buffer.byteLength(input, "utf8") > limits.maxBytes) return { ok: false, code: "TOO_LARGE" };
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.trim() === "") return { ok: false, code: "EMPTY" };

  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawAny = false; // the current record has any content (distinguishes a blank line)

  const endField = (): CsvFailure | null => {
    if (field.length > limits.maxFieldLength) return "FIELD_TOO_LONG";
    cells.push(field);
    field = "";
    return null;
  };
  const endRecord = (): CsvFailure | null => {
    const failure = endField();
    if (failure) return failure;
    if (sawAny) {
      if (cells.length > limits.maxColumns) return "TOO_MANY_COLUMNS";
      records.push({ line: recordLine, cells });
      if (records.length > limits.maxRows + 1) return "TOO_MANY_ROWS";
    }
    cells = [];
    sawAny = false;
    return null;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
        if (field.length > limits.maxFieldLength) return { ok: false, code: "FIELD_TOO_LONG" };
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ",") {
      sawAny = true;
      const failure = endField();
      if (failure) return { ok: false, code: failure };
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      const failure = endRecord();
      if (failure) return { ok: false, code: failure };
      line++;
      recordLine = line;
    } else {
      sawAny = true;
      field += ch;
    }
  }
  if (inQuotes) return { ok: false, code: "UNTERMINATED_QUOTE" };
  const failure = endRecord();
  if (failure) return { ok: false, code: failure };

  const head = records.shift();
  if (!head) return { ok: false, code: "EMPTY" };
  const header = head.cells.map((c) => c.trim());
  const lower = header.map((h) => h.toLowerCase());
  if (header.some((h) => h === "") || new Set(lower).size !== lower.length) return { ok: false, code: "DUPLICATE_HEADER" };
  if (records.length > limits.maxRows) return { ok: false, code: "TOO_MANY_ROWS" };

  const rows: CsvRow[] = records.map((r) => {
    if (r.cells.length > header.length) return { line: r.line, cells: r.cells.slice(0, header.length), tooWide: true };
    return { line: r.line, cells: [...r.cells, ...Array(header.length - r.cells.length).fill("")] };
  });
  return { ok: true, header, rows };
}
