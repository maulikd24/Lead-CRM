import { describe, expect, it } from "vitest";

import { PROVIDER_META } from "@/app/(dashboard)/settings/integrations/provider-meta";
import { GROUP_KEYS, INTEGRATION_GROUPS, aiSafetyItems, groupOf, integrationState, isGrouped, providerStatus, providersIn, STATE_LABEL, summarise, webhooksFor } from "./overview";

describe("groups", () => {
  it("are the four owner-named tabs, in order", () => {
    expect(INTEGRATION_GROUPS.map((g) => g.label)).toEqual(["Messaging", "Marketing and ads", "Data and identity", "AI and safety"]);
    expect(GROUP_KEYS).toEqual(["messaging", "marketing", "data", "ai"]);
  });
  it("place every known integration in a group explicitly, so none is ever lost", () => {
    for (const provider of Object.keys(PROVIDER_META)) expect(isGrouped(provider), provider).toBe(true);
  });
  it("put an integration the page does not know yet under Data and identity", () => {
    expect(groupOf("something_new")).toBe("data");
    expect(isGrouped("something_new")).toBe(false);
  });
  it("sort channels, ad platforms and identity sensibly", () => {
    expect(groupOf("whatsapp_meta")).toBe("messaging");
    expect(groupOf("meta_ads")).toBe("marketing");
    expect(groupOf("lead_intake")).toBe("marketing");
    expect(groupOf("clevertap")).toBe("data");
  });
});

describe("providersIn", () => {
  it("lists a group's providers in page order and keeps unknown ones last", () => {
    expect(providersIn("messaging", ["exotel", "freshdesk", "whatsapp_meta", "sms_exotel", "resend_email", "meta_ads"])).toEqual(["whatsapp_meta", "sms_exotel", "resend_email", "exotel", "freshdesk"]);
    expect(providersIn("data", ["new_thing", "jira", "clevertap"])).toEqual(["clevertap", "jira", "new_thing"]);
  });
});

describe("integrationState", () => {
  it("is connected only for live mode with credentials", () => {
    expect(integrationState({ mode: "live", hasCredentials: true, flagOn: null })).toBe("connected");
    expect(integrationState({ mode: "live", hasCredentials: false, flagOn: null })).toBe("needs_setup");
    expect(integrationState({ mode: "mock", hasCredentials: true, flagOn: null })).toBe("mock");
    expect(integrationState({ mode: null, hasCredentials: false, flagOn: null })).toBe("mock");
  });
  it("lets an off flag win, because nothing runs behind it", () => {
    expect(integrationState({ mode: "live", hasCredentials: true, flagOn: false })).toBe("flag_off");
    expect(integrationState({ mode: "live", hasCredentials: true, flagOn: true })).toBe("connected");
  });
});

describe("Mock mode is a choice, not a fault", () => {
  it("reads as Mock, never Needs setup, for an integration nobody has switched to live", () => {
    expect(integrationState({ mode: "mock", hasCredentials: false, flagOn: null })).toBe("mock");
    expect(integrationState({ mode: null, hasCredentials: false, flagOn: true })).toBe("mock");
  });
  it("keeps Needs setup for the case that really is half done: live mode chosen, no credentials saved", () => {
    expect(integrationState({ mode: "live", hasCredentials: false, flagOn: null })).toBe("needs_setup");
  });
  it("still lets an off flag win over Mock, because the flag is why nothing runs", () => {
    expect(integrationState({ mode: "mock", hasCredentials: false, flagOn: false })).toBe("flag_off");
  });
  it("has its own plain label", () => {
    expect(STATE_LABEL.mock).toBe("Mock mode");
  });
  it("a fresh install (no stored settings anywhere) has nothing under Needs setup among the integrations", () => {
    const all = ["whatsapp_meta", "sms_exotel", "resend_email", "exotel", "freshdesk", "meta_ads", "google_ads", "lead_intake", "clevertap", "clickup", "jira"];
    const states = all.map((p) => providerStatus(p, null, {}).state);
    expect(states).not.toContain("needs_setup");
    expect(states.every((s) => s === "mock" || s === "flag_off")).toBe(true);
  });
});

describe("providerStatus", () => {
  const live = { mode: "live", credentials: "encrypted" };
  it("names the flag when that is the reason", () => {
    expect(providerStatus("meta_ads", live, {})).toEqual({ state: "flag_off", flagName: "META_ADS_SYNC_ENABLED" });
    expect(providerStatus("meta_ads", live, { META_ADS_SYNC_ENABLED: "1" })).toEqual({ state: "connected", flagName: undefined });
  });
  it("treats only the exact value 1 as on", () => {
    expect(providerStatus("clevertap", live, { CLEVERTAP_PUSH_ENABLED: "true" }).state).toBe("flag_off");
  });
  it("has no flag for an integration that has none", () => {
    expect(providerStatus("jira", live, {}).state).toBe("connected");
    expect(providerStatus("jira", null, {}).state).toBe("mock");
  });
});

describe("aiSafetyItems", () => {
  const find = (env: Record<string, string>, id: string) => aiSafetyItems(env).find((i) => i.id === id)!;
  it("judges a key by whether it is set, and never shows it", () => {
    expect(find({ ANTHROPIC_API_KEY: "sk-secret-value" }, "anthropic").state).toBe("connected");
    expect(find({}, "anthropic").state).toBe("needs_setup");
    expect(JSON.stringify(aiSafetyItems({ ANTHROPIC_API_KEY: "sk-secret-value", OPENAI_API_KEY: "sk-other", AGENT_API_KEY: "agent-secret" }))).not.toMatch(/secret|sk-other/);
  });
  it("keeps the agents off until their own flag is 1", () => {
    expect(find({}, "nudger").state).toBe("flag_off");
    expect(find({ AGENT_NUDGER_ENABLED: "1" }, "nudger").state).toBe("connected");
    expect(find({ AI_AGENTS_ENABLED: "1" }, "agent-api").state).toBe("needs_setup");
    expect(find({ AI_AGENTS_ENABLED: "1", AGENT_API_KEY: "x" }, "agent-api").state).toBe("connected");
  });
  it("reports single sign-on as off, half set up, or on, without the client secret", () => {
    expect(find({}, "sso").state).toBe("flag_off");
    expect(find({ SSO_ENABLED: "1" }, "sso").state).toBe("needs_setup");
    const on = find({ SSO_ENABLED: "1", KEYCLOAK_ISSUER: "https://id.example.test/realms/x", KEYCLOAK_CLIENT_ID: "app", KEYCLOAK_CLIENT_SECRET: "topsecret", AUTH_URL: "https://crm.example.test", SSO_BREAK_GLASS_EMAILS: "a@example.test" }, "sso");
    expect(on.state).toBe("connected");
    expect(on.detail).toContain("1 break-glass account");
    expect(JSON.stringify(on)).not.toContain("topsecret");
  });
});

describe("webhooksFor", () => {
  const lists = { providers: ["freshdesk", "meta_ads", "clevertap", "jira"], channels: ["whatsapp", "sms"] };
  it("lists each integration's webhook with its group", () => {
    expect(webhooksFor("messaging", lists).map((w) => w.path)).toEqual(["/api/webhooks/freshdesk", "/api/webhooks/messaging/whatsapp", "/api/webhooks/messaging/sms"]);
    expect(webhooksFor("data", lists).map((w) => w.path)).toEqual(["/api/webhooks/clevertap", "/api/webhooks/jira"]);
  });
  it("keeps the lead endpoints with Marketing and ads, so no URL is dropped", () => {
    expect(webhooksFor("marketing", lists).map((w) => w.path)).toEqual(["/api/webhooks/meta_ads", "/api/webhooks/meta-leads", "/api/leads/google-ads", "/api/leads/web"]);
    expect(webhooksFor("ai", lists)).toEqual([]);
  });
});

describe("summarise", () => {
  it("counts each state", () => {
    expect(summarise([{ state: "connected" }, { state: "flag_off" }, { state: "connected" }])).toEqual({ connected: 2, mock: 0, needs_setup: 0, flag_off: 1 });
    expect(summarise([{ state: "mock" }, { state: "mock" }, { state: "needs_setup" }])).toEqual({ connected: 0, mock: 2, needs_setup: 1, flag_off: 0 });
  });
});
