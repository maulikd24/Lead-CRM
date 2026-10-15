import { afterEach, describe, expect, it, vi } from "vitest";

import { smsExotelAdapter } from "./sms-exotel";

afterEach(() => vi.unstubAllGlobals());

it("sends SMS with Basic auth in the header, not embedded in the URL", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ SMSMessage: { Sid: "SM1" } }), { status: 200 });
    }),
  );
  await smsExotelAdapter.configure({ sid: "SIDTEST", apiKey: "KEYTEST", apiToken: "TOKENTEST", senderId: "SENDER", webhookSecret: "s" }, {});
  const out = await smsExotelAdapter.sendMessage({ to: "9999999999", body: "hi" } as never);
  expect(out.externalId).toBe("SM1");
  expect(calls[0].url).toBe("https://api.exotel.com/v1/Accounts/SIDTEST/Sms/send.json");
  expect(calls[0].url).not.toContain("KEYTEST");
  expect(calls[0].url).not.toContain("@");
  const headers = calls[0].init?.headers as Record<string, string>;
  expect(headers.Authorization).toBe("Basic " + Buffer.from("KEYTEST:TOKENTEST").toString("base64"));
});
