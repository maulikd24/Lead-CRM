/**
 * Recording playback. The telephony provider (Exotel) stores the audio and the call webhook only gives us a URL, kept in
 * Activity.payload.recordingUrl. The browser never receives that URL: the player points at our own authenticated route,
 * which checks the viewer may see the call and then streams the audio from the provider. This module is the pure part:
 * which URLs may be fetched, and how the response is shaped. All network access is injected.
 */

const DEFAULT_HOSTS = ["exotel.com"];
const MAX_REDIRECTS = 3;

/** Provider domain plus any extra hosts from configuration (CALLS_RECORDING_HOSTS, comma separated). The stored URL is
 *  data from a webhook, so it is never allowed to widen the list. */
export function allowedRecordingHosts(extra: string | undefined): string[] {
  const more = (extra ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_HOSTS, ...more];
}

export type RecordingSource = { ok: true; url: string } | { ok: false; reason: string };

export function resolveRecordingSource(raw: string | null | undefined, hosts: string[]): RecordingSource {
  if (!raw) return { ok: false, reason: "no recording" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not https" };
  if (url.username || url.password) return { ok: false, reason: "credentials in url" };
  const host = url.hostname.toLowerCase();
  const allowed = hosts.some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) return { ok: false, reason: "host not allowed" };
  return { ok: true, url: url.toString() };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

export async function streamRecording(input: { url: string; range?: string | null; hosts: string[]; fetchImpl: FetchLike; timeoutMs?: number }): Promise<Response> {
  const first = resolveRecordingSource(input.url, input.hosts);
  if (!first.ok) return text(404, "Recording not available");

  let target = first.url;
  let upstream: Response | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await input.fetchImpl(target, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: input.range ? { range: input.range } : {},
        signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        const next = location ? resolveRecordingSource(new URL(location, target).toString(), input.hosts) : null;
        if (!next || !next.ok) return text(502, "Recording unavailable");
        target = next.url;
        continue;
      }
      upstream = res;
      break;
    }
  } catch {
    return text(502, "Recording unavailable");
  }
  if (!upstream) return text(502, "Recording unavailable");
  if (upstream.status === 404) return text(404, "Recording not available");
  if (!upstream.ok) return text(502, "Recording unavailable");

  const type = upstream.headers.get("content-type") ?? "";
  if (!type.startsWith("audio/") && type !== "application/octet-stream") return text(415, "Unsupported recording format");

  const headers = new Headers({
    "content-type": type.startsWith("audio/") ? type : "audio/mpeg",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "accept-ranges": upstream.headers.get("accept-ranges") ?? "bytes",
  });
  for (const name of ["content-length", "content-range"]) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
