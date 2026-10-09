/**
 * Contract check for the Partner workspace. Standalone, no database, GET requests only.
 *
 *   PARTNER_API_BASE=https://host/base PARTNER_API_TOKEN=... npx tsx scripts/partner-contract-check.ts
 *   optional: PARTNER_API_PREFIX=/some/prefix   (path in front of every endpoint)
 *
 * The token is read from the environment only, never from an argument. The output names fields, paths and counts;
 * it never prints a value from a response. Exit code 0 only if there are no failures. The JSON block at the end is
 * what an administrator reads before using "Mark contract verified" in Settings.
 */
import { assertSafeBaseUrl, normalisePathPrefix } from "../src/lib/partners/referral-api";
import { CONTRACT_VERSION } from "../src/lib/partners/contract";
import { checkAuthStatus, checkPaginationEcho, checkResponse, crossChecks, summarise, type Finding } from "../src/lib/partners/contract-check";
import { summarySchema, referrerPageSchema, withdrawalPageSchema } from "../src/lib/partners/schemas";

const token = process.env.PARTNER_API_TOKEN;
if (!token || !process.env.PARTNER_API_BASE) {
  console.error("Set PARTNER_API_BASE and PARTNER_API_TOKEN in the environment.");
  process.exit(2);
}
const base = assertSafeBaseUrl(process.env.PARTNER_API_BASE) + normalisePathPrefix(process.env.PARTNER_API_PREFIX);

async function get(path: string, withToken = true): Promise<{ status: number; data: unknown }> {
  const res = await fetch(base + path, {
    method: "GET",
    headers: { accept: "application/json", ...(withToken ? { authorization: `Bearer ${token}` } : {}) },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  let body: unknown = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  const data = body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body;
  return { status: res.status, data };
}

const findings: Finding[] = [];
const add = (...f: Finding[]) => findings.push(...f);
const note = (endpoint: string, status: number) => {
  if (status < 200 || status >= 300) add({ endpoint, level: "fail", code: "http_status", detail: `HTTP ${status}` });
};

async function main() {
  add(...checkAuthStatus((await get("/reports/summary", false)).status));

  const sum = await get("/reports/summary");
  note("summary", sum.status);
  add(...checkResponse("summary", sum.data));
  const summary = summarySchema.safeParse(sum.data);

  const refs = await get("/referrers?limit=2&offset=0");
  note("referrers", refs.status);
  add(...checkResponse("referrers", refs.data));
  const refsParsed = referrerPageSchema.safeParse(refs.data);
  if (refsParsed.success) {
    add(...checkPaginationEcho({ limit: 2, offset: 0 }, { limit: refsParsed.data.limit, offset: refsParsed.data.offset }));
    const first = refsParsed.data.items[0];
    if (first) {
      const one = await get(`/referrers/${encodeURIComponent(first.id)}`);
      note("referrer", one.status);
      add(...checkResponse("referrer", one.data));
    } else add({ endpoint: "referrer", level: "info", code: "no_rows", detail: "no referrer to probe the detail endpoint with" });

    const total = refsParsed.data.total;
    if (total !== null) {
      const past = await get(`/referrers?limit=2&offset=${total + 1000}`);
      const p = referrerPageSchema.safeParse(past.data);
      if (past.status !== 200 || !p.success) add({ endpoint: "pagination", level: "warn", code: "past_end", detail: "an offset beyond the end did not return an empty page" });
      else if (p.data.items.length > 0) add({ endpoint: "pagination", level: "fail", code: "past_end", detail: "an offset beyond the end returned rows" });
      if (total > 2) {
        const last = await get(`/referrers?limit=2&offset=${total - 1}`);
        const l = referrerPageSchema.safeParse(last.data);
        if (!l.success || l.data.items.length !== 1) add({ endpoint: "pagination", level: "warn", code: "last_page", detail: "the last page did not hold exactly the remaining rows" });
      }
    }
  }

  const rees = await get("/referees?limit=2&offset=0");
  note("referees", rees.status);
  add(...checkResponse("referees", rees.data));

  const wds = await get("/withdrawals?limit=2&offset=0");
  note("withdrawals", wds.status);
  add(...checkResponse("withdrawals", wds.data));
  const wdsParsed = withdrawalPageSchema.safeParse(wds.data);

  // Numbers that must agree across endpoints.
  let earningsSum: number | undefined;
  if (refsParsed.success && refsParsed.data.total !== null && refsParsed.data.total <= 2000) {
    earningsSum = 0;
    for (let offset = 0; offset < refsParsed.data.total; offset += 100) {
      const page = referrerPageSchema.safeParse((await get(`/referrers?limit=100&offset=${offset}`)).data);
      if (!page.success) { earningsSum = undefined; break; }
      earningsSum += page.data.items.reduce((a, r) => a + r.earningsTotal, 0);
    }
  } else add({ endpoint: "cross", level: "info", code: "skipped_sum", detail: "earnings sum check skipped (unknown total or more than 2000 referrers)" });

  const statusTotals: Record<string, number | null> = {};
  if (wdsParsed.success && wdsParsed.data.summary) {
    for (const status of Object.keys(wdsParsed.data.summary.byStatus).slice(0, 12)) {
      const one = withdrawalPageSchema.safeParse((await get(`/withdrawals?limit=1&status=${encodeURIComponent(status)}`)).data);
      statusTotals[status] = one.success ? one.data.total : null;
    }
  }
  add(
    ...crossChecks({
      summary: summary.success ? summary.data : undefined,
      referrersTotal: refsParsed.success ? refsParsed.data.total : undefined,
      earningsSum,
      withdrawalsSummary: wdsParsed.success ? wdsParsed.data.summary?.byStatus : undefined,
      withdrawalStatusTotals: statusTotals,
    }),
  );
}

main()
  .catch(() => add({ endpoint: "run", level: "fail", code: "request_failed", detail: "a request failed or timed out (network, TLS or base URL)" }))
  .finally(() => {
    const result = { contractVersion: CONTRACT_VERSION, ...summarise(findings), findings };
    console.log("level  endpoint     code              detail");
    for (const x of findings) console.log(`${x.level.padEnd(6)} ${x.endpoint.padEnd(12)} ${x.code.padEnd(17)} ${x.detail}`);
    if (findings.length === 0) console.log("no findings");
    console.log("\n" + JSON.stringify(result, null, 2));
    console.log(result.passed ? "\nRESULT: PASS. You may record it with Mark contract verified in Settings." : "\nRESULT: FAIL. Do not mark the contract verified.");
    process.exit(result.passed ? 0 : 1);
  });
