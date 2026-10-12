import { describe, expect, it, vi } from "vitest";
import { allowedRecordingHosts, resolveRecordingSource, streamRecording } from "./recording";

describe("resolveRecordingSource", () => {
  const hosts = allowedRecordingHosts(undefined);
  it("accepts https recordings on the telephony provider's domain", () => {
    expect(resolveRecordingSource("https://s3-ap-south-1.recordings.exotel.com/acct/abc.mp3", hosts)).toEqual({ ok: true, url: "https://s3-ap-south-1.recordings.exotel.com/acct/abc.mp3" });
  });
  it("rejects http, credentials in the URL, other hosts, IP literals and junk", () => {
    expect(resolveRecordingSource("http://recordings.exotel.com/a.mp3", hosts).ok).toBe(false);
    expect(resolveRecordingSource("https://user:pw@recordings.exotel.com/a.mp3", hosts).ok).toBe(false);
    expect(resolveRecordingSource("https://evil.example.com/a.mp3", hosts).ok).toBe(false);
    expect(resolveRecordingSource("https://exotel.com.evil.io/a.mp3", hosts).ok).toBe(false);
    expect(resolveRecordingSource("https://169.254.169.254/latest", hosts).ok).toBe(false);
    expect(resolveRecordingSource("not a url", hosts).ok).toBe(false);
    expect(resolveRecordingSource(null, hosts).ok).toBe(false);
  });
  it("extra hosts come from configuration, never from stored data", () => {
    const extra = allowedRecordingHosts("recordings.example-telco.net, other.test");
    expect(resolveRecordingSource("https://recordings.example-telco.net/a.mp3", extra).ok).toBe(true);
    expect(resolveRecordingSource("https://x.recordings.example-telco.net/a.mp3", extra).ok).toBe(false);
    expect(resolveRecordingSource("https://recordings.example-telco.net/a.mp3", hosts).ok).toBe(false);
  });
});

describe("resolveRecordingSource host tricks", () => {
  const hosts = allowedRecordingHosts("bucket.example.net/recs/, *.wild.example.org");
  it("rejects lookalike hosts, trailing-dot hosts and odd ports", () => {
    for (const u of ["https://evilexotel.com/a.mp3", "https://exotel.com.evil.com/a.mp3", "https://recordings.exotel.com./a.mp3", "https://recordings.exotel.com:8443/a.mp3"]) {
      expect(resolveRecordingSource(u, hosts).ok, u).toBe(false);
    }
  });
  it("matches exotel.com and its subdomains, extras exactly, wildcards only when written", () => {
    expect(resolveRecordingSource("https://exotel.com/a.mp3", hosts).ok).toBe(true);
    expect(resolveRecordingSource("https://a.wild.example.org/a.mp3", hosts).ok).toBe(true);
    expect(resolveRecordingSource("https://wild.example.org/a.mp3", hosts).ok).toBe(false);
    expect(resolveRecordingSource("https://sub.bucket.example.net/recs/a.mp3", hosts).ok).toBe(false);
  });
  it("enforces a path prefix on normalised paths", () => {
    expect(resolveRecordingSource("https://bucket.example.net/recs/a.mp3", hosts).ok).toBe(true);
    expect(resolveRecordingSource("https://bucket.example.net/other/a.mp3", hosts).ok).toBe(false);
    expect(resolveRecordingSource("https://bucket.example.net/recs/../other/a.mp3", hosts).ok).toBe(false);
    expect(resolveRecordingSource("https://bucket.example.net/recsx/a.mp3", hosts).ok).toBe(false);
  });
});

function audioResponse(init: ResponseInit & { body?: string } = {}) {
  return new Response(init.body ?? "audio-bytes", { status: init.status ?? 200, headers: { "content-type": "audio/mpeg", "content-length": "11", "accept-ranges": "bytes", ...(init.headers as Record<string, string>) } });
}

describe("streamRecording", () => {
  const hosts = allowedRecordingHosts(undefined);
  const url = "https://recordings.exotel.com/a.mp3";

  it("streams audio with private, no-store headers and forwards the Range header", async () => {
    const fetchImpl = vi.fn(async (_u: string, _init?: RequestInit) => audioResponse({ status: 206, headers: { "content-range": "bytes 0-10/100" } }));
    const res = await streamRecording({ url, range: "bytes=0-10", hosts, fetchImpl });
    expect(res.status).toBe(206);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-range")).toBe("bytes 0-10/100");
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).range).toBe("bytes=0-10");
    expect(fetchImpl.mock.calls[0][1]?.credentials).toBe("omit");
  });
  it("refuses a disallowed URL without calling out", async () => {
    const fetchImpl = vi.fn();
    const res = await streamRecording({ url: "https://evil.example.com/a.mp3", hosts, fetchImpl });
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("maps upstream failures and non-audio bodies to safe statuses", async () => {
    expect((await streamRecording({ url, hosts, fetchImpl: async () => new Response("", { status: 404 }) })).status).toBe(404);
    expect((await streamRecording({ url, hosts, fetchImpl: async () => new Response("", { status: 500 }) })).status).toBe(502);
    expect((await streamRecording({ url, hosts, fetchImpl: async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }) })).status).toBe(415);
    expect((await streamRecording({ url, hosts, fetchImpl: async () => { throw new Error("boom"); } })).status).toBe(502);
  });
  it("follows a redirect only to another allowed host", async () => {
    const ok = vi.fn(async (u: string) => (u === url ? new Response(null, { status: 302, headers: { location: "https://cdn.recordings.exotel.com/b.mp3" } }) : audioResponse()));
    expect((await streamRecording({ url, hosts, fetchImpl: ok })).status).toBe(200);
    const bad = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/b.mp3" } }));
    expect((await streamRecording({ url, hosts, fetchImpl: bad })).status).toBe(502);
    expect(bad).toHaveBeenCalledTimes(1);
  });
  it("never echoes the provider URL in an error body", async () => {
    const res = await streamRecording({ url, hosts, fetchImpl: async () => { throw new Error("connect ECONNREFUSED recordings.exotel.com"); } });
    expect(await res.text()).not.toContain("exotel");
  });
  it("keeps streaming after the header timeout has passed", async () => {
    const body = new ReadableStream({ start(c) { setTimeout(() => { c.enqueue(new TextEncoder().encode("late")); c.close(); }, 80); } });
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => undefined);
      return new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const res = await streamRecording({ url, hosts, fetchImpl, timeoutMs: 20 });
    expect(await res.text()).toBe("late");
  });
  it("aborts when the headers never arrive", async () => {
    const fetchImpl = (_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    expect((await streamRecording({ url, hosts, fetchImpl, timeoutMs: 20 })).status).toBe(502);
  });
  it("passes a 416 through and drops malformed Range headers", async () => {
    const fetchImpl = vi.fn(async (_u: string, _init?: RequestInit) => new Response(null, { status: 416, headers: { "content-range": "bytes */100" } }));
    const res = await streamRecording({ url, range: "bytes=500-", hosts, fetchImpl });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */100");
    const ok = vi.fn(async (_u: string, _init?: RequestInit) => audioResponse());
    await streamRecording({ url, range: "bytes=0-1,5-9", hosts, fetchImpl: ok });
    expect(ok.mock.calls[0][1]?.headers).toEqual({});
  });
});
