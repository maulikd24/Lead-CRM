import { createHash } from "node:crypto";
import { z } from "zod";

import { ingestPortfolioBatch, type IngestDeps } from "@/lib/portfolio-feed/ingest";
import { mapBatch, mapCustomerEntry, type CustomerIdentity } from "@/lib/portfolio-feed/mapper";
import { resolveMatch, type IdentityHits } from "@/lib/portfolio-feed/match";
import type { FeedRepo } from "@/lib/portfolio-feed/write";
import { normalizeEmail } from "@/lib/utils/normalize-contact";

import { buildClientRows, buildFeedEntries, type ClientRow, type LineError } from "./build";
import { parseCsv, type CsvFailure } from "./csv";
import type { BackOfficeMapping, FileKind } from "./mapping";

/** Stored with each run, so keep it bounded. Counts are always exact. */
export const MAX_STORED_ERRORS = 200;

export type ClientProfile = { name: string; email: string | null; mobile: string | null; city: string | null; state: string | null; clientType: string | null; investmentCategory: string | null };
export interface ClientRepo {
  getProfiles(ids: string[]): Promise<Map<string, ClientProfile>>;
  update(id: string, data: Partial<ClientProfile>): Promise<void>;
}

export type RunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED_DUPLICATE";
export type Trigger = "CRON" | "UPLOAD";
export type RunRecord = { kind: FileKind; fileName: string; checksum: string; dryRun: boolean; trigger: Trigger; userId: string | null; status: RunStatus; counts?: unknown; errors?: unknown };
export interface RunsRepo {
  /** A real (not dry) run of this exact file finished with SUCCESS or PARTIAL. */
  hasCompleted(checksum: string, kind: FileKind): Promise<boolean>;
  /** A real run of this exact file started recently and has not finished. */
  hasRunning(checksum: string, kind: FileKind): Promise<boolean>;
  start(input: Omit<RunRecord, "status" | "counts" | "errors">): Promise<{ id: string; seq: number }>;
  finish(id: string, result: { status: RunStatus; counts?: unknown; errors?: unknown }): Promise<void>;
}

export type RunAudit = { runId: string; kind: FileKind; dryRun: boolean; trigger: Trigger; userId: string | null; status: RunStatus; counts: unknown; errorCount: number };
export type RunDeps = {
  lookup: IngestDeps["lookup"];
  feedRepo: FeedRepo;
  clientRepo: ClientRepo;
  runs: RunsRepo;
  /** Counts only. A failure never fails the run. */
  audit: (entry: RunAudit) => Promise<void>;
  now?: () => number;
};

export type RunInput = { kind: FileKind; text: string; fileName: string; dryRun: boolean; trigger: Trigger; userId: string | null; force?: boolean };
type Counts = { created: number; updated: number; unchanged: number; stale: number; failed: number };
export type ClientCounts = { received: number; matched: number; updated: number; unchanged: number; unmatched: number; ambiguous: number; invalid: number; fieldsChanged: Record<string, number> };
export type RunCounts = {
  rows?: { received: number; skipped: number };
  customers?: { received: number; matched: number; unmatched: number; ambiguous: number; invalid: number };
  holdings?: Counts;
  transactions?: Counts;
  clients?: ClientCounts;
};

export type ImportOutcome = {
  kind: FileKind;
  fileName: string;
  checksum: string;
  dryRun: boolean;
  status: Exclude<RunStatus, "RUNNING">;
  runId?: string;
  counts: RunCounts;
  errors: LineError[];
  errorsTruncated: boolean;
  /** Set when status is FAILED. */
  failureCode?: CsvFailure | "MISSING_COLUMN" | "INTERNAL_ERROR";
  /** Config field names whose columns are absent from the file (MISSING_COLUMN only). */
  missingFields?: string[];
  /** Set when status is SKIPPED_DUPLICATE. */
  reason?: "already_imported" | "in_progress";
};

export const checksumOf = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Same reads as the real repo, no writes: ids for not-yet-existing accounts and products are synthetic. */
export function dryRunFeedRepo(repo: FeedRepo): FeedRepo {
  let n = 0;
  return {
    findAccounts: (numbers) => repo.findAccounts(numbers),
    ensureAccount: async ({ accountNumber, clientId }) => (await repo.findAccounts([accountNumber])).get(accountNumber) ?? { id: `dry-account-${++n}`, clientId },
    findProducts: (codes) => repo.findProducts(codes),
    ensureProduct: async ({ productCode }) => (await repo.findProducts([productCode])).get(productCode) ?? { id: `dry-product-${++n}` },
    findPositions: (keys) => repo.findPositions(keys),
    createPosition: async () => {},
    updatePosition: async () => {},
    findTransactions: (refs) => repo.findTransactions(refs),
    createTransaction: async () => {},
    updateTransaction: async () => {},
  };
}

const zeroCounts = (): Counts => ({ created: 0, updated: 0, unchanged: 0, stale: 0, failed: 0 });

export async function runImport(input: RunInput, mapping: BackOfficeMapping, deps: RunDeps): Promise<ImportOutcome> {
  const checksum = checksumOf(input.text);
  const base = { kind: input.kind, fileName: input.fileName, checksum, dryRun: input.dryRun };
  const skipped = (reason: "already_imported" | "in_progress"): ImportOutcome => ({ ...base, status: "SKIPPED_DUPLICATE", reason, counts: {}, errors: [], errorsTruncated: false });

  if (!input.dryRun && !input.force) {
    if (await deps.runs.hasCompleted(checksum, input.kind)) return skipped("already_imported");
    if (await deps.runs.hasRunning(checksum, input.kind)) return skipped("in_progress");
  }

  const run = await deps.runs.start({ kind: input.kind, fileName: input.fileName, checksum, dryRun: input.dryRun, trigger: input.trigger, userId: input.userId });
  const finish = async (outcome: Omit<ImportOutcome, "runId" | "errorsTruncated" | "errors"> & { errors: LineError[] }): Promise<ImportOutcome> => {
    const sorted = [...outcome.errors].sort((a, b) => a.line - b.line);
    const errors = sorted.slice(0, MAX_STORED_ERRORS);
    const result: ImportOutcome = { ...outcome, runId: run.id, errors, errorsTruncated: sorted.length > errors.length };
    await deps.runs.finish(run.id, { status: result.status, counts: { ...result.counts, ...(result.failureCode ? { failureCode: result.failureCode, missingFields: result.missingFields } : {}) }, errors });
    await deps.audit({ runId: run.id, kind: input.kind, dryRun: input.dryRun, trigger: input.trigger, userId: input.userId, status: result.status, counts: result.counts, errorCount: sorted.length }).catch(() => console.error("Back-office import: audit record failed"));
    return result;
  };
  const failed = (failureCode: NonNullable<ImportOutcome["failureCode"]>, missingFields?: string[]) =>
    finish({ ...base, status: "FAILED", counts: {}, errors: [], failureCode, ...(missingFields ? { missingFields } : {}) });

  try {
    const csv = parseCsv(input.text);
    if (!csv.ok) return await failed(csv.code);

    const now = deps.now?.() ?? Date.now();
    if (input.kind === "CLIENTS") {
      const built = buildClientRows(csv, mapping);
      if (!built.ok) return await failed(built.code, built.fields);
      const applied = await applyClients(built.rows, built.rowCount, mapping, deps, input.dryRun);
      const errors = [...built.lineErrors, ...applied.errors];
      return await finish({ ...base, status: errors.length ? "PARTIAL" : "SUCCESS", counts: { clients: applied.counts }, errors });
    }

    const built = buildFeedEntries(input.kind, csv, mapping, { revision: run.seq });
    if (!built.ok) return await failed(built.code, built.fields);
    const envelope = { version: 1 as const, batchId: `bo-${run.seq}`, customers: built.entries.map((e) => e.entry) };
    const repo = input.dryRun ? dryRunFeedRepo(deps.feedRepo) : deps.feedRepo;
    const summary = await ingestPortfolioBatch(envelope, { lookup: deps.lookup, repo, audit: async () => {}, now: () => now });

    // Mapper-level row errors carry field names; the ingest summary only carries codes.
    const fieldsAt = new Map<string, string[]>();
    mapBatch(envelope.customers, now).forEach((m, i) => {
      if (m.ok) for (const e of m.rowErrors) fieldsAt.set(`${i}:${e.kind}:${e.index}`, e.fields);
    });
    const errors: LineError[] = [...built.lineErrors];
    for (const r of summary.results) {
      const lines = built.entries[r.index].lines;
      if (r.status === "matched") {
        for (const e of r.errors ?? []) {
          const line = (e.kind === "holding" ? lines.holdings : lines.transactions)[e.index];
          errors.push({ line, code: e.code, fields: fieldsAt.get(`${r.index}:${e.kind}:${e.index}`) ?? [] });
        }
        continue;
      }
      const code = r.status === "unmatched" ? "CUSTOMER_UNMATCHED" : r.status === "ambiguous" ? "CUSTOMER_AMBIGUOUS" : r.code;
      for (const line of [...lines.holdings, ...lines.transactions]) errors.push({ line, code, fields: [] });
    }
    const counts: RunCounts = { rows: { received: built.rowCount, skipped: built.lineErrors.length }, customers: summary.counts.customers, holdings: summary.counts.holdings, transactions: summary.counts.transactions };
    return await finish({ ...base, status: errors.length ? "PARTIAL" : "SUCCESS", counts, errors });
  } catch (error) {
    // Class name only: messages can carry identifiers.
    console.error(`Back-office import failed (${error instanceof Error ? error.name : "unknown"})`);
    return await failed("INTERNAL_ERROR");
  }
}

// ---- client master -----------------------------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const profileSchemas = {
  name: text(200),
  city: text(100),
  state: text(100),
  clientType: text(100),
  investmentCategory: text(100),
  email: z.string().trim().max(200).pipe(z.email()),
  mobile: z.string().trim().max(25).refine((v) => /^[0-9+()\s-]+$/.test(v) && v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15),
} as const;
type ProfileField = keyof typeof profileSchemas;
const OVERWRITABLE: ProfileField[] = ["name", "city", "state", "clientType", "investmentCategory"];
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

async function applyClients(rows: ClientRow[], received: number, mapping: BackOfficeMapping, deps: RunDeps, dryRun: boolean): Promise<{ counts: ClientCounts; errors: LineError[] }> {
  const counts: ClientCounts = { received, matched: 0, updated: 0, unchanged: 0, unmatched: 0, ambiguous: 0, invalid: 0, fieldsChanged: {} };
  const errors: LineError[] = [];
  const bad = (line: number, code: string, fields: string[] = []) => void errors.push({ line, code, fields });

  // Validate every row first: profile values, then the identity through the portfolio-feed's own identifier rules.
  const valid: { line: number; identity: CustomerIdentity; profile: Partial<Record<ProfileField, string>> }[] = [];
  for (const row of rows) {
    const profile: Partial<Record<ProfileField, string>> = {};
    const badFields: string[] = [];
    const email = row.customer.email;
    const candidates: Record<string, string | undefined> = { ...row.profile, ...(email ? { email } : {}), ...(row.customer.mobile ? { mobile: row.customer.mobile } : {}) };
    for (const [field, value] of Object.entries(candidates)) {
      if (value === undefined) continue;
      const p = profileSchemas[field as ProfileField].safeParse(value);
      if (p.success) profile[field as ProfileField] = p.data;
      else badFields.push(field);
    }
    if (badFields.length) {
      counts.invalid++;
      bad(row.line, "INVALID_ROW", badFields);
      continue;
    }
    const mapped = mapCustomerEntry({ customer: row.customer });
    if (!mapped.ok) {
      counts.invalid++;
      bad(row.line, mapped.code);
      continue;
    }
    valid.push({ line: row.line, identity: mapped.identity, profile });
  }

  const hits: IdentityHits[] = valid.length ? await deps.lookup(valid.map((v) => v.identity)) : [];
  const matches = valid.map((v, i) => ({ ...v, match: resolveMatch(hits[i] ?? {}) }));

  // A client named by more than one row is refused in all of its rows: a resend must always land the same.
  const seen = new Map<string, number>();
  for (const m of matches) if (m.match.status === "matched") seen.set(m.match.clientId, (seen.get(m.match.clientId) ?? 0) + 1);

  const profiles = await deps.clientRepo.getProfiles([...seen.keys()]);
  for (const m of matches) {
    if (m.match.status === "unmatched") {
      counts.unmatched++;
      bad(m.line, "CUSTOMER_UNMATCHED");
      continue;
    }
    if (m.match.status === "ambiguous") {
      counts.ambiguous++;
      bad(m.line, "CUSTOMER_AMBIGUOUS");
      continue;
    }
    if ((seen.get(m.match.clientId) ?? 0) > 1) {
      counts.invalid++;
      bad(m.line, "DUPLICATE_KEY");
      continue;
    }
    counts.matched++;
    const current = profiles.get(m.match.clientId);
    if (!current) {
      counts.unmatched++;
      counts.matched--;
      bad(m.line, "CUSTOMER_UNMATCHED");
      continue;
    }
    const change: Partial<ClientProfile> = {};
    for (const field of Object.keys(profileSchemas) as ProfileField[]) {
      const next = m.profile[field];
      if (next === undefined) continue;
      const existing = current[field];
      const same = field === "email" ? existing !== null && normalizeEmail(existing) === normalizeEmail(next) : existing === next;
      if (same) continue;
      const replace = mapping.updatePolicy === "overwrite" && OVERWRITABLE.includes(field);
      if (blank(existing) || replace) change[field] = next;
    }
    const fields = Object.keys(change);
    if (fields.length === 0) {
      counts.unchanged++;
      continue;
    }
    if (!dryRun) {
      try {
        await deps.clientRepo.update(m.match.clientId, change);
      } catch (error) {
        console.error(`Back-office import: client update failed (${error instanceof Error ? error.name : "unknown"})`);
        bad(m.line, "WRITE_FAILED");
        continue;
      }
    }
    counts.updated++;
    for (const f of fields) counts.fieldsChanged[f] = (counts.fieldsChanged[f] ?? 0) + 1;
  }
  return { counts, errors };
}
