import type { PatternCheck } from "./destinations";

/**
 * Destination health. Two layers: the URL pattern (always, pure) and, for a public https web page, one HEAD request to see that it answers.
 * The probe is deliberately narrow so a scheduled job cannot be turned against our own network: https only, the default port, a real public
 * host name (no IP address, no localhost, no .local or .internal), no credentials, redirects are NOT followed, five seconds, nothing in the
 * request but the URL. Custom app schemes and WhatsApp links are never called (they are checked by pattern only).
 */
export type ProbeResult = { reachable: boolean; message: string };
export type ProbeFetch = (url: string, init: RequestInit) => Promise<{ status: number }>;

const PROBE_TIMEOUT_MS = 5_000;
const INTERNAL_HOST = /(^|\.)(localhost|local|internal|lan|home|corp|invalid)$/i;

export function isProbeable(kind: string, raw: string): boolean {
  if (kind !== "WEB_LANDING" && kind !== "APP_DEEP_LINK") return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname;
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host) || /^\d+$/.test(host.replace(/\./g, ""))) return false;
  if (url.hostname === "wa.me" || url.hostname.endsWith("whatsapp.com")) return false;
  return !INTERNAL_HOST.test(host.replace(/\.$/, ""));
}

export async function probeDestination(raw: string, doFetch: ProbeFetch): Promise<ProbeResult> {
  if (!isProbeable("WEB_LANDING", raw)) return { reachable: false, message: "This address is not one the health check calls." };
  try {
    const res = await doFetch(raw, { method: "HEAD", redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { "user-agent": "planner-health-check" } });
    if (res.status >= 200 && res.status < 400) return { reachable: true, message: `Answered HTTP ${res.status}.` };
    return { reachable: false, message: `The page answered HTTP ${res.status}.` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { reachable: false, message: name === "AbortError" || name === "TimeoutError" ? "The page did not answer within 5 seconds." : "The page could not be reached." };
  }
}

/** The stored verdict: a bad pattern always wins; otherwise the probe (when there was one) decides. */
export function decideHealth(pattern: PatternCheck, probe: ProbeResult | null): { ok: boolean; message: string } {
  if (!pattern.ok) return { ok: false, message: pattern.message };
  if (!probe) return { ok: true, message: `${pattern.message} Not called (only web pages are).` };
  return { ok: probe.reachable, message: probe.message };
}
