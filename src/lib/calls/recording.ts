/**
 * Recording playback. The telephony provider (Exotel) stores the audio and the call webhook only gives us a URL, kept in
 * Activity.payload.recordingUrl. The browser never receives that URL: the player points at our own authenticated route,
 * which checks the viewer may see the call and then streams the audio from the provider. This module is the pure part:
 * which URLs may be fetched, and how the response is shaped. All network access is injected.
 */

const DEFAULT_HOSTS = ["exotel.com", "*.exotel.com"];
const MAX_REDIRECTS = 3;
const RANGE = /^bytes=\d*-\d*$/;

/** Provider domain plus any extra entries from configuration (CALLS_RECORDING_HOSTS, comma separated). An entry is
 *  `host[/path/prefix]` and matches that exact host; a leading `*.` also allows its subdomains. The stored URL is data
 *  from a webhook, so it is never allowed to widen the list. */
export function allowedRecordingHosts(extra: string | undefined): string[] {
  const more = (extra ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_HOSTS, ...more];
}

export type RecordingSource = { ok: true; url: string } | { ok: false; reason: string };

function entryAllows(entry: string, host: string, path: string): boolean {
  const slash = entry.indexOf("/");
  const hostPart = slash === -1 ? entry : entry.slice(0, slash);
  const prefix = slash === -1 ? "" : entry.slice(slash);
  const hostOk = hostPart.startsWith("*.") ? host.endsWith(hostPart.slice(1)) : host === hostPart;
  if (!hostOk) return false;
  if (!prefix) return true;
  const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(dir);
}

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
  if (url.port !== "") return { ok: false, reason: "port not allowed" };
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".")) return { ok: false, reason: "host not allowed" };
  // URL normalises "." and ".." segments, so the prefix is checked against the path that would actually be requested.
  if (!hosts.some((h) => entryAllows(h, host, url.pathname))) return { ok: false, reason: "host not allowed" };
  return { ok: true, url: url.toString() };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

export async function streamRecording(input: { url: string; range?: string | null; hosts: string[]; fetchImpl: FetchLike; timeoutMs?: number; signal?: AbortSignal }): Promise<Response> {
  const first = resolveRecordingSource(input.url, input.hosts);
  if (!first.ok) return text(404, "Recording not available");

  let target = first.url;
  let upstream: Response | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // The timeout covers only the wait for response headers; the body then streams for as long as playback needs.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
      const onClientGone = () => controller.abort();
      input.signal?.addEventListener("abort", onClientGone, { once: true });
      let res: Response;
      try {
        res = await input.fetchImpl(target, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: input.range && RANGE.test(input.range) ? { range: input.range } : {},
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
        if (input.signal?.aborted) controller.abort();
      }
      if (res.status >= 300 && res.status < 400) {
        void res.body?.cancel().catch(() => undefined);
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
  if (upstream.status === 416) {
    void upstream.body?.cancel().catch(() => undefined);
    const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("content-range", cr);
    return new Response(null, { status: 416, headers });
  }
  if (upstream.status === 404) {
    void upstream.body?.cancel().catch(() => undefined);
    return text(404, "Recording not available");
  }
  if (!upstream.ok) {
    void upstream.body?.cancel().catch(() => undefined);
    return text(502, "Recording unavailable");
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!type.startsWith("audio/") && type !== "application/octet-stream") {
    void upstream.body?.cancel().catch(() => undefined);
    return text(415, "Unsupported recording format");
  }

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
