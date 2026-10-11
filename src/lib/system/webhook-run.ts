import type { JobSpec } from "./job-registry";
import { errorClassOf, recordOutcome, type RunStatus, type RunStore } from "./job-run";

/**
 * Records an inbound webhook / ingest route as a JobRun, without touching the request or the response.
 *  - 2xx and 3xx -> OK; 401 and 403 (signature or secret failures) -> REJECTED, a security signal that is counted and shown but never
 *    stored with a body or header; any other 4xx -> OK with the status as a count (a client error is not our failure); 5xx or a throw -> FAILED.
 *  - The request body is never read here, so signature checks and body handling are unchanged.
 *  - The row is written after the response is decided (Next's after() where available), so latency is unchanged and a failing store
 *    can never change what the sender sees.
 */
export function classifyResponse(status: number): { status: RunStatus; errorClass?: string; summary?: Record<string, number> } {
  if (status === 401 || status === 403) return { status: "REJECTED", summary: { httpStatus: status } };
  if (status >= 500) return { status: "FAILED", errorClass: `Http${status}`, summary: { httpStatus: status } };
  if (status >= 400) return { status: "OK", summary: { httpStatus: status } };
  return { status: "OK" };
}

export type WebhookRunDeps = {
  store: RunStore;
  schedule: (fn: () => Promise<void>) => void;
  now?: () => Date;
  newId?: () => string;
  env?: Record<string, string | undefined>;
};

export type WithRunRecordOptions = {
  /** Set false for a poll (the WhatsApp worker asks for its outbox every few seconds): successes are not stored, failures and rejections are. */
  recordOk?: boolean;
};

export function createWithRunRecord(deps: WebhookRunDeps) {
  const env = deps.env ?? process.env;
  const deployRef = env.VERCEL_GIT_COMMIT_SHA && env.VERCEL_GIT_COMMIT_SHA.length >= 7 ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : undefined;

  return function withRunRecord<A extends unknown[]>(
    spec: JobSpec,
    handler: (request: Request, ...rest: A) => Promise<Response>,
    options: WithRunRecordOptions = {},
  ): (request: Request, ...rest: A) => Promise<Response> {
    const recordOk = options.recordOk ?? true;
    return async (request, ...rest) => {
      const started = (deps.now ?? (() => new Date()))();
      const record = (outcome: { status: RunStatus; errorClass?: string; summary?: Record<string, number> }) => {
        if (outcome.status === "OK" && !recordOk) return;
        const finished = (deps.now ?? (() => new Date()))();
        deps.schedule(() =>
          recordOutcome(spec, { store: deps.store, now: deps.now, newId: deps.newId, deployRef, trigger: spec.key.replace(/^webhook:/, "") }, { ...outcome, startedAt: started, durationMs: Math.max(0, finished.getTime() - started.getTime()) }),
        );
      };
      let response: Response;
      try {
        response = await handler(request, ...rest);
      } catch (error) {
        record({ status: "FAILED", errorClass: errorClassOf(error) });
        throw error;
      }
      record(classifyResponse(response.status));
      return response;
    };
  };
}
