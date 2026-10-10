import { cache } from "react";

import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { resolveConnection, REFERRAL_API_PROVIDER, type Connection } from "./connection";
import { CONTRACT_VERSION } from "./contract";
import { createMockReferralApi } from "./mock-data";
import type { PartnerAccess } from "./access";
import { createNativePort, type NativeDb, type NativePartnerPort } from "./native/queries";
import type { PartnerScope } from "./native/scope";
import { createReferralApiClient, ReferralApiError, type ReferralApiErrorKind, type ReferralApiPort } from "./referral-api";
import { resolvePartnerSource, type PartnerSource } from "./source";
import type { ContractInfo } from "./status";

export type Loaded<T> = { status: "ok"; data: T; sample: boolean; contractVerified: boolean; source: PartnerSource } | { status: "not_connected" } | { status: "error"; kind: ReferralApiErrorKind };

/** Runs a read against whichever connection is configured and folds every failure into a plain result. Never throws. */
export async function runWithConnection<T>(
  conn: Connection,
  fn: (api: ReferralApiPort) => Promise<T>,
  deps: { fetch?: typeof fetch } = {},
): Promise<Loaded<T>> {
  if (conn.state === "not_connected") return { status: "not_connected" };
  try {
    const api = conn.state === "mock" ? createMockReferralApi() : createReferralApiClient({ baseUrl: conn.baseUrl, token: conn.token, pathPrefix: conn.pathPrefix, fetch: deps.fetch });
    return { status: "ok", data: await fn(api), sample: conn.state === "mock", contractVerified: conn.state === "live" && conn.contractVerified, source: conn.state === "mock" ? "sample" : "external" };
  } catch (e) {
    // Only the kind survives: messages and bodies can carry internals.
    return { status: "error", kind: e instanceof ReferralApiError ? e.kind : "server" };
  }
}

/** Reads through this CRM's own earnings tables, narrowed to what the caller may see. Never throws; only the error kind survives. */
export async function loadNative<T>(
  access: Pick<PartnerAccess, "scope">,
  fn: (port: NativePartnerPort) => Promise<T>,
  deps: { createPort?: (scope: PartnerScope) => NativePartnerPort } = {},
): Promise<Loaded<T>> {
  try {
    const port = (deps.createPort ?? ((scope) => createNativePort(prisma as unknown as NativeDb, scope)))(access.scope);
    // There is no external contract behind native data, so it is always "verified": the page shows no warning.
    return { status: "ok", data: await fn(port), sample: false, contractVerified: true, source: "native" };
  } catch (e) {
    return { status: "error", kind: e instanceof ReferralApiError ? e.kind : "server" };
  }
}

export async function getConnection(): Promise<Connection> {
  // PARTNER_SOURCE=sample: made-up data for development, whatever the integration row says (the production guard still applies).
  if (resolvePartnerSource() === "sample") return resolveConnection(null);
  const row = await prisma.integrationConfig.findUnique({ where: { provider: REFERRAL_API_PROVIDER } });
  if (!row) return resolveConnection(null);
  let credentials: Record<string, unknown> = {};
  try {
    credentials = row.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
  } catch {
    return { state: "not_connected" };
  }
  return resolveConnection({ mode: row.mode, isEnabled: row.isEnabled, credentials, settings: (row.settings as Record<string, unknown> | null) ?? null });
}

export async function loadReferralData<T>(fn: (api: ReferralApiPort) => Promise<T>): Promise<Loaded<T>> {
  return runWithConnection(await getConnection(), fn);
}

/** The programme summary, loaded once per request: the Overview section and the rail beside every section share it. */
export const loadSummaryOnce = cache(() => loadReferralData((api) => api.getSummary()));

/** The same for the native source: one summary per request, shared by the Overview and the rail beside every section. */
export const loadNativeSummaryOnce = cache((access: PartnerAccess) => loadNative(access, async (port) => ({ summary: await port.getSummary(), extras: await port.getOverviewExtras() })));

/** What the Contract check section shows: the connection state and whether a passing check is on record. Never throws, never returns credentials. */
export async function loadContractInfo(): Promise<ContractInfo> {
  const conn = await getConnection().catch((): Connection => ({ state: "not_connected" }));
  const row = await prisma.integrationConfig.findUnique({ where: { provider: REFERRAL_API_PROVIDER }, select: { settings: true } }).catch(() => null);
  const at = (row?.settings as Record<string, unknown> | null)?.contractVerifiedAt;
  const verified = conn.state === "live" && conn.contractVerified;
  return { state: conn.state, verified, verifiedAt: verified && typeof at === "string" ? at : null, version: CONTRACT_VERSION };
}

export { errorCopy } from "./copy";
