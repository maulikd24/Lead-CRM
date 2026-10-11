import { TICK_KEY, type JobKind, type JobSpec } from "./job-registry";

/**
 * Records every run of a cron job, webhook or manual run as a JobRun row, WITHOUT changing what the job does. Prisma-free: the store,
 * the clock and the id generator are injected (job-run-db.ts wires the real ones), so every rule here is a unit test.
 *
 * Rules that cannot be bent:
 * - A job's result and failure behaviour are exactly as before: a throw becomes `{ error: message }` for the caller, one job's failure
 *   never stops the next, and the job is never cancelled or retried here (a run over its budget is REPORTED as TIMEOUT, not enforced).
 * - Persistence never breaks the tick: every store call is caught and time-boxed; a failure only sets `persistFailed`.
 * - Only counts and error CLASSES are stored. Never a payload, a customer value, a secret or a driver message.
 */
export type RunStatus = "RUNNING" | "OK" | "SKIPPED" | "FAILED" | "TIMEOUT" | "ABANDONED" | "REJECTED";
export type RunKind = "CRON" | "WEBHOOK" | "MANUAL" | "RETRY";

export type RunRow = {
  id: string;
  kind: RunKind;
  job: string;
  tickId: string | null;
  status: RunStatus;
  skipReason: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  attempt: number;
  retryOfId: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  summary: Record<string, number | boolean> | null;
  trigger: string | null;
  deployRef: string | null;
};

export interface RunStore {
  insert(row: RunRow): Promise<void>;
  update(id: string, patch: Partial<RunRow>): Promise<void>;
  createMany(rows: RunRow[]): Promise<void>;
}

const SUMMARY_MAX_BYTES = 2048;
const MESSAGE_MAX = 300;

/** Replaces anything that could carry a secret or a person's data. The scrubbed text is still never shown for database errors (see errorDetails). */
export function scrubMessage(raw: string): string {
  const out = raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "[redacted]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[redacted]")
    .replace(/\b(?:sk|pk|key|token|secret|api)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted]")
    .replace(/\d{10,}/g, "[redacted]")
    .replace(/[A-Za-z0-9+/_-]{32,}/g, "[redacted]");
  return out.length > MESSAGE_MAX ? out.slice(0, MESSAGE_MAX - 1) + "…" : out;
}

export function errorClassOf(error: unknown): string {
  if (!(error instanceof Error)) return "NonErrorThrown";
  const code = (error as { code?: unknown }).code;
  const name = error.name && error.name !== "Error" ? error.name : error.constructor?.name && error.constructor.name !== "Error" ? error.constructor.name : "Error";
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? `${name}:${code}` : name;
}

/** Database and driver errors carry the failing statement and its values: only the class is kept. Anything not an Error: class only. */
function errorMessageOf(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (/^Prisma/.test(error.name) || "severity" in error || "routine" in error) return null;
  return scrubMessage(error.message);
}

const isLeaf = (v: unknown): v is number | boolean => (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean";

/** The result object reduced to numeric and boolean leaves (one level of nesting), at most 2 KB. A job that returns rows or text stores nothing. */
export function summarizeResult(result: unknown): Record<string, number | boolean> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    if (isLeaf(v)) out[k] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (isLeaf(v2)) out[`${k}.${k2}`] = v2;
    }
  }
  while (JSON.stringify(out).length > SUMMARY_MAX_BYTES) {
    const keys = Object.keys(out);
    delete out[keys[keys.length - 1]];
  }
  return Object.keys(out).length ? out : null;
}

type Classified = { status: RunStatus; skipReason?: string; errorClass?: string };

function classifyReturned(result: unknown): Classified | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if ("skipped" in r && r.skipped) return { status: "SKIPPED", skipReason: typeof r.skipped === "string" ? scrubMessage(r.skipped).slice(0, 60) : "skipped" };
  if (typeof r.error === "string" && r.error) return { status: "FAILED", errorClass: /^[A-Za-z0-9_:.-]{1,60}$/.test(r.error) ? r.error : "ReturnedError" };
  // The ad syncs report a failed run as a returned status rather than a throw.
  if (r.status === "FAILED") return { status: "FAILED", errorClass: "ReturnedFailure" };
  return null;
}

export type RecorderOptions = {
  store: RunStore;
  now?: () => Date;
  newId?: () => string;
  tickId?: string;
  trigger?: string;
  deployRef?: string;
  env?: Record<string, string | undefined>;
  kind?: RunKind;
  attempt?: number;
  retryOfId?: string;
  flushEvery?: number;
  storeTimeoutMs?: number;
};

const defaultId = () => `jr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const OVER_BUDGET = 3;

export function createRecorder(opts: RecorderOptions) {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? defaultId;
  const flushEvery = opts.flushEvery ?? 15;
  const timeoutMs = opts.storeTimeoutMs ?? 1000;
  const env = opts.env ?? process.env;
  const tickId = opts.tickId ?? null;
  const startedAt = now();
  let buffer: RunRow[] = [];
  let loggedPersist = false;
  const counts = { jobs: 0, ok: 0, failed: 0, skipped: 0, timeout: 0 };
  const recorder = { persistFailed: false } as { persistFailed: boolean } & Record<string, unknown>;

  async function guarded(label: string, fn: () => Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([fn(), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("store timeout")), timeoutMs); })]);
    } catch {
      recorder.persistFailed = true;
      if (!loggedPersist) { loggedPersist = true; console.error(`Control plane could not record ${label}; the job itself is unaffected`); }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await guarded("job runs", () => opts.store.createMany(batch));
  }

  const row = (spec: JobSpec | { key: string; kind: JobKind }, p: Partial<RunRow>): RunRow => ({
    id: newId(), kind: opts.kind ?? spec.kind, job: spec.key, tickId, status: "OK", skipReason: null, startedAt: now(), finishedAt: null, durationMs: null,
    attempt: opts.attempt ?? 1, retryOfId: opts.retryOfId ?? null, errorClass: null, errorMessage: null, summary: null, trigger: opts.trigger ?? null, deployRef: opts.deployRef ?? null, ...p,
  });

  async function run<T>(spec: JobSpec, fn: () => Promise<T>): Promise<T | { error: string }> {
    const t0 = now();
    let result: T | { error: string };
    let thrown: { error: unknown } | null = null;
    try {
      result = await fn();
    } catch (error) {
      console.error(`Cron job "${spec.key}" failed`, error);
      thrown = { error };
      result = { error: error instanceof Error ? error.message : "Unknown error" };
    }
    const t1 = now();
    const durationMs = Math.max(0, t1.getTime() - t0.getTime());
    const over = durationMs > spec.expectedMaxMs * OVER_BUDGET;
    let c: Classified;
    let errorMessage: string | null = null;
    if (thrown) {
      c = { status: "FAILED", errorClass: errorClassOf(thrown.error) };
      errorMessage = errorMessageOf(thrown.error);
    } else {
      const returned = classifyReturned(result);
      if (returned) c = returned;
      else if (over) c = { status: "TIMEOUT", errorClass: "ExceededBudget" };
      else if (spec.flag && env[spec.flag] !== "1") c = { status: "SKIPPED", skipReason: "flag off" };
      else c = { status: "OK" };
    }
    if (c.status === "TIMEOUT") errorMessage = `Ran ${durationMs} ms against a budget of ${spec.expectedMaxMs} ms; the job was not cancelled`;
    counts.jobs += 1;
    if (c.status === "OK") counts.ok += 1; else if (c.status === "SKIPPED") counts.skipped += 1; else if (c.status === "TIMEOUT") counts.timeout += 1; else counts.failed += 1;
    buffer.push(row(spec, { status: c.status, skipReason: c.skipReason ?? null, startedAt: t0, finishedAt: t1, durationMs, errorClass: c.errorClass ?? null, errorMessage, summary: thrown ? null : summarizeResult(result) }));
    if (buffer.length >= flushEvery) await flush();
    return result;
  }

  async function startTick(): Promise<void> {
    if (!tickId) return;
    await guarded("the tick", () => opts.store.insert(row({ key: TICK_KEY, kind: "CRON" }, { id: tickId, status: "RUNNING", startedAt })));
  }

  async function finishTick(status: RunStatus = "OK"): Promise<void> {
    if (!tickId) return;
    const finishedAt = now();
    const summary: Record<string, number | boolean> = { ...counts };
    if (recorder.persistFailed) summary.persistFailed = true;
    await guarded("the tick", () => opts.store.update(tickId, { status, finishedAt, durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()), summary }));
  }

  async function recordSkippedTick(reason: string): Promise<void> {
    if (!tickId) return;
    const t = now();
    buffer.push(row({ key: TICK_KEY, kind: "CRON" }, { id: tickId, status: "SKIPPED", skipReason: reason, startedAt: t, finishedAt: t, durationMs: 0 }));
    await flush();
  }

  return Object.assign(recorder, { run, flush, startTick, finishTick, recordSkippedTick, counts }) as {
    persistFailed: boolean; run: typeof run; flush: typeof flush; startTick: typeof startTick; finishTick: typeof finishTick; recordSkippedTick: typeof recordSkippedTick; counts: typeof counts;
  };
}

/** One run, written straight away: webhooks, manual runs and retries. */
export async function recordRun<T>(spec: JobSpec, ctx: Omit<RecorderOptions, "tickId" | "flushEvery">, fn: () => Promise<T>): Promise<T | { error: string }> {
  const rec = createRecorder({ ...ctx, flushEvery: 1 });
  const result = await rec.run(spec, fn);
  await rec.flush();
  return result;
}

export type Outcome = { status: RunStatus; errorClass?: string; summary?: Record<string, number | boolean> | null; startedAt?: Date; durationMs?: number; skipReason?: string };

/** Writes one row for an outcome the caller already knows (a webhook whose response is decided). Never throws. */
export async function recordOutcome(spec: JobSpec, ctx: Omit<RecorderOptions, "tickId" | "flushEvery">, outcome: Outcome): Promise<void> {
  const now = ctx.now ?? (() => new Date());
  const newId = ctx.newId ?? defaultId;
  const finishedAt = now();
  const row: RunRow = {
    id: newId(), kind: ctx.kind ?? spec.kind, job: spec.key, tickId: null, status: outcome.status, skipReason: outcome.skipReason ?? null,
    startedAt: outcome.startedAt ?? finishedAt, finishedAt, durationMs: outcome.durationMs ?? 0, attempt: ctx.attempt ?? 1, retryOfId: ctx.retryOfId ?? null,
    errorClass: outcome.errorClass ?? null, errorMessage: null, summary: outcome.summary ?? null, trigger: ctx.trigger ?? null, deployRef: ctx.deployRef ?? null,
  };
  try {
    await ctx.store.createMany([row]);
  } catch {
    console.error("Control plane could not record a run; the caller is unaffected");
  }
}
