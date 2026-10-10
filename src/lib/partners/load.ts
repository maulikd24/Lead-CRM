import { cache } from "react";

import { prisma } from "@/lib/db/prisma";
import { createMockReferralApi } from "./mock-data";
import type { PartnerAccess } from "./access";
import { createNativePort, type NativeDb, type NativePartnerPort } from "./native/queries";
import type { PartnerScope } from "./native/scope";
import { PartnerReadError, type PartnerReadErrorKind, type SamplePartnerPort } from "./sample-port";
import { sampleAllowed, type PartnerSource } from "./source";

export type Loaded<T> = { status: "ok"; data: T; sample: boolean; source: PartnerSource } | { status: "not_connected" } | { status: "error"; kind: PartnerReadErrorKind };

/** Reads the made-up development data. Outside development it is "not connected": nothing fabricated is ever shown. Never throws. */
export async function loadSample<T>(fn: (api: SamplePartnerPort) => Promise<T>, deps: { env?: Record<string, string | undefined> } = {}): Promise<Loaded<T>> {
  if (!sampleAllowed(deps.env ?? process.env)) return { status: "not_connected" };
  try {
    return { status: "ok", data: await fn(createMockReferralApi()), sample: true, source: "sample" };
  } catch (e) {
    // Only the kind survives: messages can carry internals.
    return { status: "error", kind: e instanceof PartnerReadError ? e.kind : "server" };
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
    return { status: "ok", data: await fn(port), sample: false, source: "native" };
  } catch (e) {
    return { status: "error", kind: e instanceof PartnerReadError ? e.kind : "server" };
  }
}

/** The programme summary from the sample data, loaded once per request: the Overview section and the rail beside every section share it. */
export const loadSummaryOnce = cache(() => loadSample((api) => api.getSummary()));

/** The same for the native source: one summary per request, shared by the Overview and the rail beside every section. */
export const loadNativeSummaryOnce = cache((access: PartnerAccess) => loadNative(access, async (port) => ({ summary: await port.getSummary(), extras: await port.getOverviewExtras() })));

export { errorCopy } from "./copy";
