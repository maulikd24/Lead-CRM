import { afterEach, describe, expect, it, vi } from "vitest";

import { exotelAdapter } from "./exotel";

afterEach(() => vi.unstubAllGlobals());

const creds = { sid: "SIDTEST", apiKey: "KEYTEST", apiToken: "TOKENTEST", callerId: "0800000000" };
const basic = "Basic " + Buffer.from("KEYTEST:TOKENTEST").toString("base64");

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }),
  );
  return calls;
}

describe("exotel adapter request shape", () => {
  it("testConnection sends Basic auth in the header and keeps credentials out of the URL", async () => {
    const calls = stubFetch();
    await exotelAdapter.configure(creds, {});
    const res = await exotelAdapter.testConnection();
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.exotel.com/v1/Accounts/SIDTEST.json");
    expect(calls[0].url).not.toContain("KEYTEST");
    expect(calls[0].url).not.toContain("TOKENTEST");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(basic);
  });

  it("initiateCall posts with the header and no credentials in the URL", async () => {
    const calls = stubFetch();
    await exotelAdapter.configure(creds, {});
    const out = await exotelAdapter.actions.initiateCall!({ mobile: "9999999999" } as never, {} as never);
    expect(out.success).toBe(true);
    expect(calls[0].url).toBe("https://api.exotel.com/v1/Accounts/SIDTEST/Calls/connect.json");
    expect(calls[0].url).not.toContain("@");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(basic);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });
});
