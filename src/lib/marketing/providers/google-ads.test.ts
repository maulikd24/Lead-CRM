import { describe, expect, it, vi } from "vitest";

import { AdsApiError } from "../ads-error";
import { DEFAULT_GOOGLE_ADS_VERSION, GoogleAdsError, createGoogleAdsClient, resolveGoogleAdsVersion } from "./google-ads";

const CREDS = { customerId: "123-456-7890", developerToken: "DEV_TOKEN_SECRET", clientId: "CLIENT_ID_X", clientSecret: "CLIENT_SECRET_SECRET", refreshToken: "REFRESH_SECRET" };
const SECRETS = [CREDS.developerToken, CREDS.clientSecret, CREDS.refreshToken, "ACCESS_SECRET"];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const tokenReply = () => json({ access_token: "ACCESS_SECRET", expires_in: 3600, token_type: "Bearer" });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function make(handler: Handler, extra: Record<string, unknown> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  });
  const client = createGoogleAdsClient({ ...CREDS, fetch: fetchImpl as unknown as typeof fetch, sleep: async () => {}, ...extra });
  return { client, calls, fetchImpl };
}

const customer = (currency = "INR", tz = "Asia/Kolkata") => json({ results: [{ customer: { descriptiveName: "Main", currencyCode: currency, timeZone: tz } }] });
/** Token exchange and the account query get stock answers; everything else is answered by `search`. */
const route = (search: () => Response, account: () => Response = customer): Handler => (url, init) =>
  url.includes("oauth2.googleapis.com") ? tokenReply() : String(init.body).includes("FROM customer") ? account() : search();
const result = (over: Record<string, unknown> = {}) => ({
  campaign: { id: "555", name: "Search - Demat" },
  segments: { date: "2026-10-01" },
  metrics: { costMicros: "1234560000", impressions: "10000", clicks: "250", conversions: 12.4 },
  ...over,
});

describe("resolveGoogleAdsVersion", () => {
  it("defaults, accepts vNN and rejects junk", () => {
    expect(resolveGoogleAdsVersion(undefined)).toBe(DEFAULT_GOOGLE_ADS_VERSION);
    expect(resolveGoogleAdsVersion("v23")).toBe("v23");
    expect(resolveGoogleAdsVersion("24")).toBe("v24");
    expect(resolveGoogleAdsVersion("../evil")).toBe(DEFAULT_GOOGLE_ADS_VERSION);
  });
});

describe("createGoogleAdsClient configuration", () => {
  it("rejects a malformed customer id or any missing credential without touching the network", () => {
    const fetchImpl = vi.fn();
    const base = { ...CREDS, fetch: fetchImpl as unknown as typeof fetch };
    expect(() => createGoogleAdsClient({ ...base, customerId: "abc" })).toThrow(GoogleAdsError);
    expect(() => createGoogleAdsClient({ ...base, developerToken: " " })).toThrow(GoogleAdsError);
    expect(() => createGoogleAdsClient({ ...base, refreshToken: "" })).toThrow(GoogleAdsError);
    expect(() => createGoogleAdsClient({ ...base, loginCustomerId: "x" })).toThrow(GoogleAdsError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("errors are AdsApiError so the shared sync treats them like Meta's", () => {
    expect(new GoogleAdsError("auth", "x")).toBeInstanceOf(AdsApiError);
  });
});

describe("authentication", () => {
  it("exchanges the refresh token once (secrets in the POST body, never the URL) and reuses the access token", async () => {
    const { client, calls } = make(route(() => json({ results: [] })));
    await client.getInsights({ since: "2026-10-01", until: "2026-10-02" });
    await client.getInsights({ since: "2026-10-03", until: "2026-10-04" });
    const tokenCalls = calls.filter((c) => c.url.includes("oauth2.googleapis.com"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(tokenCalls[0].init.method).toBe("POST");
    const body = new URLSearchParams(String(tokenCalls[0].init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe(CREDS.refreshToken);
    expect(body.get("client_id")).toBe(CREDS.clientId);
    for (const c of calls) for (const s of SECRETS) expect(c.url).not.toContain(s);
  });

  it("refreshes again when the access token has expired", async () => {
    let now = 1_000_000;
    const { client, calls } = make(route(() => json({ results: [] })), { now: () => now });
    await client.getInsights({ since: "2026-10-01", until: "2026-10-01" });
    now += 3_700_000;
    await client.getInsights({ since: "2026-10-01", until: "2026-10-01" });
    expect(calls.filter((c) => c.url.includes("oauth2.googleapis.com"))).toHaveLength(2);
  });

  it("maps an invalid grant to an auth error without echoing Google's body", async () => {
    const { client } = make((url) => (url.includes("oauth2") ? json({ error: "invalid_grant", error_description: "SECRET-DETAIL" }, 400) : json({})));
    const error = await client.getAccount().catch((e) => e);
    expect(error).toBeInstanceOf(GoogleAdsError);
    expect(error.kind).toBe("auth");
    expect(error.message).not.toContain("SECRET-DETAIL");
  });
});

describe("getAccount", () => {
  it("reads name, currency and timezone with a GAQL query, sending the developer token and the bearer header", async () => {
    const { client, calls } = make(route(() => json({})));
    expect(await client.getAccount()).toEqual({ name: "Main", currency: "INR", timezoneName: "Asia/Kolkata" });
    const call = calls.find((c) => c.url.includes("googleads.googleapis.com"))!;
    expect(call.url).toBe(`https://googleads.googleapis.com/${DEFAULT_GOOGLE_ADS_VERSION}/customers/1234567890/googleAds:search`);
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ACCESS_SECRET");
    expect(headers["developer-token"]).toBe(CREDS.developerToken);
    expect(headers["login-customer-id"]).toBeUndefined();
    expect(JSON.parse(String(call.init.body)).query).toMatch(/FROM customer/);
  });

  it("sends the manager account id when one is configured", async () => {
    const { client, calls } = make(route(() => json({ results: [{ customer: { descriptiveName: "M", currencyCode: "INR", timeZone: "Asia/Kolkata" } }] })), { loginCustomerId: "987-654-3210" });
    await client.getAccount();
    expect((calls[1].init.headers as Record<string, string>)["login-customer-id"]).toBe("9876543210");
  });
});

describe("getInsights", () => {
  it("queries campaign metrics by day for the window and converts micros to minor units", async () => {
    const { client, calls } = make(route(() => json({ results: [result()] })));
    const rows = await client.getInsights({ since: "2026-10-01", until: "2026-10-07" });
    expect(rows).toEqual([{ campaignId: "555", campaignName: "Search - Demat", date: "2026-10-01", spendMinor: BigInt(123456), currency: "INR", impressions: 10000, clicks: 250, reach: 0, leads: 12 }]);
    const query = JSON.parse(String(calls[calls.length - 1].init.body)).query as string;
    expect(query).toContain("FROM campaign");
    expect(query).toContain("segments.date BETWEEN '2026-10-01' AND '2026-10-07'");
    expect(query).toMatch(/metrics\.cost_micros/);
  });

  it("only ever issues read queries: the one non-GET call is the token exchange and the search endpoint", async () => {
    const { client, calls } = make(route(() => json({ results: [] })));
    await client.getInsights({ since: "2026-10-01", until: "2026-10-01" });
    for (const c of calls) expect(c.url).toMatch(/oauth2\.googleapis\.com\/token$|googleAds:search$/);
    expect(calls.some((c) => /mutate/i.test(c.url))).toBe(false);
  });

  it("rejects dates that are not plain YYYY-MM-DD so nothing can be injected into the query", async () => {
    const { client, fetchImpl } = make(route(() => json({ results: [] })));
    await expect(client.getInsights({ since: "2026-10-01' OR 1=1 --", until: "2026-10-02" })).rejects.toBeInstanceOf(GoogleAdsError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows nextPageToken until it is gone and stops at the page cap", async () => {
    let page = 0;
    const { client } = make(route(() => (++page < 3 ? json({ results: [result({ segments: { date: `2026-10-0${page}` } })], nextPageToken: `t${page}` }) : json({ results: [result({ segments: { date: "2026-10-03" } })] }))));
    expect(await client.getInsights({ since: "2026-10-01", until: "2026-10-03" })).toHaveLength(3);

    const loop = make(route(() => json({ results: [result()], nextPageToken: "same" })), { maxPages: 3 });
    const error = await loop.client.getInsights({ since: "2026-10-01", until: "2026-10-03" }).catch((e) => e);
    expect(error.kind).toBe("paging");
  });

  it("skips a row without a campaign id and reports the count, instead of failing the window", async () => {
    const skipped: number[] = [];
    const { client } = make(route(() => json({ results: [result(), result({ campaign: { name: "No id" } })] })));
    const rows = await client.getInsights({ since: "2026-10-01", until: "2026-10-01", onSkip: (n) => skipped.push(n) });
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([1]);
  });

  it("rounds cost half up in currencies with 2 decimals and handles zero-decimal currencies", async () => {
    const { client } = make(route(() => json({ results: [result({ metrics: { costMicros: "1500000", impressions: "1", clicks: "1", conversions: 0 } })] }), () => customer("JPY", "Asia/Tokyo")));
    const rows = await client.getInsights({ since: "2026-10-01", until: "2026-10-01" });
    expect(rows[0].currency).toBe("JPY");
    expect(rows[0].spendMinor).toBe(BigInt(2)); // 1.5 yen rounds half up
  });

  it("a changed response shape is a schema error, never silent zeros", async () => {
    const { client } = make(route(() => json({ results: [{ campaign: { id: "1" }, segments: { date: "2026-10-01" }, metrics: { costMicros: "abc" } }] })));
    const error = await client.getInsights({ since: "2026-10-01", until: "2026-10-01" }).catch((e) => e);
    expect(error.kind).toBe("schema");
  });
});

describe("getCreativeInsights", () => {
  it("reads ad-level metrics and names an ad without a name after its id", async () => {
    const { client, calls } = make(
      route(() =>
        json({
          results: [
            { campaign: { id: "555", name: "Search" }, adGroupAd: { ad: { id: "77", name: "Headline A", type: "RESPONSIVE_SEARCH_AD" } }, segments: { date: "2026-10-01" }, metrics: { costMicros: "500000000", impressions: "900", clicks: "30", conversions: 2 } },
            { campaign: { id: "555", name: "Search" }, adGroupAd: { ad: { id: "78", type: "RESPONSIVE_SEARCH_AD" } }, segments: { date: "2026-10-01" }, metrics: { costMicros: "0", impressions: "0", clicks: "0", conversions: 0 } },
          ],
        }),
      ),
    );
    const rows = await client.getCreativeInsights({ since: "2026-10-01", until: "2026-10-01" });
    expect(rows.map((r) => [r.adId, r.adName, r.campaignId, r.spendMinor, r.leads])).toEqual([
      ["77", "Headline A", "555", BigInt(50000), 2],
      ["78", "Ad 78", "555", BigInt(0), 0],
    ]);
    expect(JSON.parse(String(calls[calls.length - 1].init.body)).query).toContain("FROM ad_group_ad");
  });
});

describe("error classification", () => {
  const search = (status: number, body: unknown, headers: Record<string, string> = {}) => make((url) => (url.includes("oauth2") ? tokenReply() : json(body, status, headers)));

  it("401 and 403 are auth errors; 429 is a rate limit; 5xx is retried once then transient", async () => {
    expect((await search(401, {}).client.getAccount().catch((e) => e)).kind).toBe("auth");
    expect((await search(403, { error: { status: "PERMISSION_DENIED" } }).client.getAccount().catch((e) => e)).kind).toBe("auth");
    const limited = await search(429, {}, { "retry-after": "30" }).client.getAccount().catch((e) => e);
    expect(limited.kind).toBe("rate_limit");
    const flaky = search(503, {});
    expect((await flaky.client.getAccount().catch((e) => e)).kind).toBe("transient");
    expect(flaky.calls.filter((c) => c.url.includes("googleads")).length).toBe(2);
  });

  it("never puts a response body, token or secret into an error message", async () => {
    const { client } = search(400, { error: { message: "BODY-TEXT-LEAK " + SECRETS.join(" ") } });
    const error = await client.getAccount().catch((e) => e);
    expect(error.kind).toBe("http");
    for (const s of [...SECRETS, "BODY-TEXT-LEAK"]) expect(error.message).not.toContain(s);
  });

  it("a request that times out is a timeout error", async () => {
    const { client } = make((url) => {
      if (url.includes("oauth2")) return tokenReply();
      throw Object.assign(new Error("x"), { name: "TimeoutError" });
    });
    expect((await client.getAccount().catch((e) => e)).kind).toBe("timeout");
  });

  it("stops with a deadline error once the sync budget has passed", async () => {
    const { client, fetchImpl } = make(route(() => json({ results: [] })), { now: () => 2000 });
    const error = await client.getInsights({ since: "2026-10-01", until: "2026-10-01", deadlineMs: 1000 }).catch((e) => e);
    expect(error.kind).toBe("deadline");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
