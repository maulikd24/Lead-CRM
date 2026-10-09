import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { resolveConnection, REFERRAL_API_PROVIDER, type Connection } from "./connection";
import { createMockReferralApi } from "./mock-data";
import { createReferralApiClient, ReferralApiError, type ReferralApiErrorKind, type ReferralApiPort } from "./referral-api";

export type Loaded<T> = { status: "ok"; data: T; sample: boolean } | { status: "not_connected" } | { status: "error"; kind: ReferralApiErrorKind };

/** Runs a read against whichever connection is configured and folds every failure into a plain result. Never throws. */
export async function runWithConnection<T>(
  conn: Connection,
  fn: (api: ReferralApiPort) => Promise<T>,
  deps: { fetch?: typeof fetch } = {},
): Promise<Loaded<T>> {
  if (conn.state === "not_connected") return { status: "not_connected" };
  try {
    const api = conn.state === "mock" ? createMockReferralApi() : createReferralApiClient({ baseUrl: conn.baseUrl, token: conn.token, fetch: deps.fetch });
    return { status: "ok", data: await fn(api), sample: conn.state === "mock" };
  } catch (e) {
    // Only the kind survives: messages and bodies can carry internals.
    return { status: "error", kind: e instanceof ReferralApiError ? e.kind : "server" };
  }
}

export async function getConnection(): Promise<Connection> {
  const row = await prisma.integrationConfig.findUnique({ where: { provider: REFERRAL_API_PROVIDER } });
  if (!row) return resolveConnection(null);
  let credentials: Record<string, unknown> = {};
  try {
    credentials = row.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
  } catch {
    return { state: "not_connected" };
  }
  return resolveConnection({ mode: row.mode, isEnabled: row.isEnabled, credentials });
}

export async function loadReferralData<T>(fn: (api: ReferralApiPort) => Promise<T>): Promise<Loaded<T>> {
  return runWithConnection(await getConnection(), fn);
}

export { errorCopy } from "./copy";
