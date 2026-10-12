import { mapBatch, type CustomerIdentity, type Envelope, type MappedCustomer, type RowError } from "./mapper";
import { resolveMatch, type IdentityHits } from "./match";
import { writeCustomerRows, type FeedRepo, type RowOutcome } from "./write";

export type IngestDeps = {
  /** One hit list per identity, in the same order. Pure lookup: it must never create customers. */
  lookup: (identities: CustomerIdentity[]) => Promise<IdentityHits[]>;
  repo: FeedRepo;
  /** Best-effort audit record of the batch (counts only). A failure never fails the batch. */
  audit: (summary: IngestSummary) => Promise<void>;
  now?: () => number;
};

type Counts = { created: number; updated: number; unchanged: number; stale: number; failed: number };
export type RowReport = { kind: "holding" | "transaction"; index: number; code: string };

export type CustomerResult =
  | { index: number; status: "matched"; holdings: Counts; transactions: Counts; errors?: RowReport[] }
  | { index: number; status: "unmatched"; code?: "NO_STRONG_ID" }
  | { index: number; status: "ambiguous" }
  | { index: number; status: "invalid"; code: "INVALID_ENTRY" | "INVALID_IDENTIFIER" | "TOO_MANY_ROWS" };

export type IngestSummary = {
  version: 1;
  batchId: string;
  counts: { customers: { received: number; matched: number; unmatched: number; ambiguous: number; invalid: number }; holdings: Counts; transactions: Counts };
  results: CustomerResult[];
};

const zero = (): Counts => ({ created: 0, updated: 0, unchanged: 0, stale: 0, failed: 0 });
function tally(into: Counts, outcomes: RowOutcome[], reports: RowReport[], kind: RowReport["kind"]) {
  for (const o of outcomes) {
    into[o.status]++;
    if (o.status === "failed") reports.push({ kind, index: o.index, code: o.code });
  }
}

/** 200 when every customer matched and every row was accepted (stale rows are expected on a late replay and do not
 * count); 207 (multi-status) when anything else was reported. */
export function httpStatusFor(summary: IngestSummary): 200 | 207 {
  const c = summary.counts;
  const problems = c.customers.unmatched + c.customers.ambiguous + c.customers.invalid + c.holdings.failed + c.transactions.failed;
  const rowErrors = summary.results.some((r) => r.status === "matched" && (r.errors?.length ?? 0) > 0);
  return problems > 0 || rowErrors ? 207 : 200;
}

/**
 * Applies one validated batch. Customers are independent: an unmatched, ambiguous or invalid customer is reported
 * and skipped, never created, and never stops the others. The summary is personal-data free: positions and codes only.
 * Infrastructure failures (lookup) propagate so the route can answer with a generic 500 and the sender retries
 * the whole batch, which is safe because every write is idempotent.
 */
export async function ingestPortfolioBatch(envelope: Envelope, deps: IngestDeps): Promise<IngestSummary> {
  const now = deps.now?.() ?? Date.now();
  const mapped: MappedCustomer[] = mapBatch(envelope.customers, now);

  const validIdx = mapped.flatMap((m, i) => (m.ok ? [i] : []));
  const hitsList = validIdx.length
    ? await deps.lookup(validIdx.map((i) => (mapped[i] as Extract<MappedCustomer, { ok: true }>).identity))
    : [];
  const hitsByIndex = new Map(validIdx.map((i, k) => [i, hitsList[k] ?? {}]));

  const summary: IngestSummary = {
    version: 1,
    batchId: envelope.batchId,
    counts: { customers: { received: envelope.customers.length, matched: 0, unmatched: 0, ambiguous: 0, invalid: 0 }, holdings: zero(), transactions: zero() },
    results: [],
  };

  for (let index = 0; index < mapped.length; index++) {
    const m = mapped[index];
    if (!m.ok) {
      if (m.code === "NO_STRONG_ID") {
        summary.counts.customers.unmatched++;
        summary.results.push({ index, status: "unmatched", code: "NO_STRONG_ID" });
        continue;
      }
      summary.counts.customers.invalid++;
      summary.results.push({ index, status: "invalid", code: m.code });
      continue;
    }
    const match = resolveMatch(hitsByIndex.get(index) ?? {});
    if (match.status !== "matched") {
      summary.counts.customers[match.status]++;
      summary.results.push(match.status === "unmatched" && match.code ? { index, status: "unmatched", code: match.code } : { index, status: match.status });
      continue;
    }
    summary.counts.customers.matched++;
    const outcome = await writeCustomerRows(deps.repo, match.clientId, m);
    const holdings = zero();
    const transactions = zero();
    const errors: RowReport[] = m.rowErrors.map((e: RowError) => ({ kind: e.kind, index: e.index, code: e.code }));
    tally(holdings, outcome.holdings, errors, "holding");
    tally(transactions, outcome.transactions, errors, "transaction");
    // Rows refused by the mapper (invalid, duplicate key) never reached the writer; count them as failed so totals add up.
    holdings.failed += m.rowErrors.filter((e) => e.kind === "holding").length;
    transactions.failed += m.rowErrors.filter((e) => e.kind === "transaction").length;
    for (const k of ["created", "updated", "unchanged", "stale", "failed"] as const) {
      summary.counts.holdings[k] += holdings[k];
      summary.counts.transactions[k] += transactions[k];
    }
    summary.results.push({ index, status: "matched", holdings, transactions, ...(errors.length ? { errors } : {}) });
  }

  try {
    await deps.audit(summary);
  } catch {
    console.error("Portfolio feed: audit record failed");
  }
  return summary;
}
