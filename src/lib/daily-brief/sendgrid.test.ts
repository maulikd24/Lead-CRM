import { describe, expect, it, vi } from "vitest";
import { parseSender, sendBriefEmail, SENDGRID_SEND_URL } from "./sendgrid";

const mail = { to: "rm@allvest.test", subject: "Your day", html: "<p>hi</p>", text: "hi" };

describe("parseSender", () => {
  it("splits a display name and address", () => {
    expect(parseSender("Allvest CRM <crm@allvest.co>")).toEqual({ email: "crm@allvest.co", name: "Allvest CRM" });
  });
  it("accepts a quoted display name", () => {
    expect(parseSender('"Allvest CRM" <crm@allvest.co>')).toEqual({ email: "crm@allvest.co", name: "Allvest CRM" });
  });
  it("accepts a bare address", () => {
    expect(parseSender("  crm@allvest.co ")).toEqual({ email: "crm@allvest.co" });
  });
});

describe("sendBriefEmail", () => {
  it("posts a v3 mail/send request with the key as bearer and both bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "m1" } }));
    const out = await sendBriefEmail(mail, { apiKey: "SG.test", from: "Allvest CRM <crm@allvest.co>" }, fetchImpl as unknown as typeof fetch);

    expect(out).toEqual({ messageId: "m1" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SENDGRID_SEND_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SG.test");
    const body = JSON.parse(init.body as string);
    expect(body.from).toEqual({ email: "crm@allvest.co", name: "Allvest CRM" });
    expect(body.personalizations).toEqual([{ to: [{ email: "rm@allvest.test" }] }]);
    expect(body.subject).toBe("Your day");
    expect(body.content).toEqual([
      { type: "text/plain", value: "hi" },
      { type: "text/html", value: "<p>hi</p>" },
    ]);
  });

  it("throws with the status and a trimmed detail when SendGrid rejects the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("x".repeat(500), { status: 403 }));
    const err = await sendBriefEmail(mail, { apiKey: "k", from: "crm@allvest.co" }, fetchImpl as unknown as typeof fetch).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message.startsWith("SendGrid responded 403: ")).toBe(true);
    expect((err as Error).message.length).toBeLessThan(330);
  });

  it("treats a 200 as a failure, since the v3 API only confirms with 202", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await expect(sendBriefEmail(mail, { apiKey: "k", from: "crm@allvest.co" }, fetchImpl as unknown as typeof fetch)).rejects.toThrow("SendGrid responded 200");
  });
});
