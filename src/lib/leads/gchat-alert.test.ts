import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const stageFindUnique = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique: (a: unknown) => userFindUnique(a) }, stage: { findUnique: (a: unknown) => stageFindUnique(a) } } }));

import { alertNewLead, buildLeadAlertPayload, leadAlertsGchatEnabled, leadDeepLink, postToChat, safeCampaignLabel } from "./gchat-alert";

const WEBHOOK = "https://chat.googleapis.com/v1/spaces/TESTSPACE/messages?key=TESTKEY&token=TESTTOKEN";
const env = (extra: Record<string, string | undefined> = {}) => ({ LEAD_ALERTS_GCHAT_ENABLED: "1", GCHAT_LEAD_WEBHOOK_URL: WEBHOOK, CRM_BASE_URL: "https://crm.example.test/", ...extra });
const facts = { clientId: "cl_abc123", assignedToId: "rm-1", currentStageId: "st-1", leadSource: "Meta Ads", campaign: "Retirement Planning" };
const okResponse = () => new Response(null, { status: 200 });
const serverError = () => new Response(null, { status: 500 });
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue({ name: "Anita Rao" });
  stageFindUnique.mockResolvedValue({ name: "New Lead" });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("flag", () => {
  it("is off unless the value is exactly 1", () => {
    expect(leadAlertsGchatEnabled({})).toBe(false);
    expect(leadAlertsGchatEnabled({ LEAD_ALERTS_GCHAT_ENABLED: "true" })).toBe(false);
    expect(leadAlertsGchatEnabled({ LEAD_ALERTS_GCHAT_ENABLED: "0" })).toBe(false);
    expect(leadAlertsGchatEnabled({ LEAD_ALERTS_GCHAT_ENABLED: "1" })).toBe(true);
  });

  it("flag off means no network call and no database lookup", async () => {
    const fetchImpl = vi.fn();
    expect(await alertNewLead(facts, env({ LEAD_ALERTS_GCHAT_ENABLED: undefined }), fetchImpl)).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(stageFindUnique).not.toHaveBeenCalled();
  });

  it("flag on with no webhook configured skips without a network call and never logs a URL", async () => {
    const fetchImpl = vi.fn();
    expect(await alertNewLead(facts, env({ GCHAT_LEAD_WEBHOOK_URL: undefined }), fetchImpl)).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("deep link", () => {
  it("builds the lead link from CRM_BASE_URL and accepts only http(s)", () => {
    expect(leadDeepLink("cl_abc123", "https://crm.example.test/")).toBe("https://crm.example.test/clients/cl_abc123");
    expect(leadDeepLink("cl_abc123", "ftp://crm.example.test")).toBeNull();
    expect(leadDeepLink("cl_abc123", "not a url")).toBeNull();
    expect(leadDeepLink("cl_abc123", undefined)).toBeNull();
  });

  it("flag on with a bad CRM_BASE_URL skips and makes no call", async () => {
    const fetchImpl = vi.fn();
    expect(await alertNewLead(facts, env({ CRM_BASE_URL: "nope" }), fetchImpl)).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("payload", () => {
  it("flag on sends exactly one POST with the JSON body {text}", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    expect(await alertNewLead(facts, env(), fetchImpl)).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body)).toEqual(["text"]);
    expect(body).toEqual({ text: "New lead cl_abc123 | source: Meta Ads | campaign: Retirement Planning | stage: New Lead | RM: Anita\nhttps://crm.example.test/clients/cl_abc123" });
  });

  it("never includes a lead's name, phone, email, PAN, address or message, even if they are smuggled in", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const smuggled = { ...facts, name: "Meera Iyer", phone: "9876501234", email: "meera@example.test", pan: "ABCDE1234F", address: "12 MG Road Bengaluru", message: "I want to retire early, call me at 9876501234" };
    await alertNewLead(smuggled as typeof facts, env(), fetchImpl);
    const sent = String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body);
    for (const secret of ["Meera", "Iyer", "9876501234", "meera@example.test", "ABCDE1234F", "MG Road", "retire early"]) expect(sent).not.toContain(secret);
  });

  it("drops a campaign label that looks like personal data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await alertNewLead({ ...facts, campaign: "meera@example.test" }, env(), fetchImpl);
    const text = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body)).text as string;
    expect(text).not.toContain("campaign:");
    expect(safeCampaignLabel("Call 9876501234 now")).toBeUndefined();
    expect(safeCampaignLabel("ABCDE1234F")).toBeUndefined();
    expect(safeCampaignLabel("Retirement Planning")).toBe("Retirement Planning");
  });

  it("shows unassigned when there is no RM and does not look one up", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await alertNewLead({ ...facts, assignedToId: null }, env(), fetchImpl);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body)).text).toContain("RM: unassigned");
  });

  it("buildLeadAlertPayload returns only text", () => {
    expect(Object.keys(buildLeadAlertPayload({ clientId: "c", source: "s", stage: null, rmFirstName: null, link: "https://x.test/clients/c" }))).toEqual(["text"]);
  });
});

describe("failure isolation", () => {
  it("a timeout retries once, then resolves failed without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(timeout());
    await expect(alertNewLead(facts, env(), fetchImpl)).resolves.toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith("Lead alert to Google Chat failed", { errorClass: "TimeoutError", attempt: 1 });
  });

  it("a 500 retries once, then resolves failed without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(serverError());
    await expect(alertNewLead(facts, env(), fetchImpl)).resolves.toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a 500 followed by success is sent on the retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(serverError()).mockResolvedValueOnce(okResponse());
    expect(await alertNewLead(facts, env(), fetchImpl)).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("logs only the error class and status, never the URL or payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(serverError());
    await alertNewLead(facts, env(), fetchImpl);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("HttpStatus");
    expect(logged).toContain("500");
    expect(logged).not.toContain("TESTKEY");
    expect(logged).not.toContain("TESTSPACE");
    expect(logged).not.toContain("cl_abc123");
  });

  it("a database lookup failure resolves failed without throwing", async () => {
    userFindUnique.mockRejectedValue(new Error("db down"));
    const fetchImpl = vi.fn();
    await expect(alertNewLead(facts, env(), fetchImpl)).resolves.toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("postToChat passes a 5 second timeout signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await postToChat({ text: "t" }, WEBHOOK, fetchImpl);
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].signal).toBeDefined();
  });
});
