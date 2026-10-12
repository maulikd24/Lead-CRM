import { afterEach, describe, expect, it, vi } from "vitest";

import { assertJiraBaseUrl, jiraAdapter } from "./jira";

// jira.ts pulls task-sync, which pulls the Prisma client. These tests never touch the DB.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("assertJiraBaseUrl", () => {
  it("rejects plain http", () => {
    expect(() => assertJiraBaseUrl("http://acme.atlassian.net", {})).toThrow(/https/);
  });

  it("rejects an arbitrary host", () => {
    expect(() => assertJiraBaseUrl("https://evil.example.com", {})).toThrow(/Atlassian Cloud/);
    expect(() => assertJiraBaseUrl("https://acme.atlassian.net.evil.example.com", {})).toThrow(/Atlassian Cloud/);
    expect(() => assertJiraBaseUrl("https://atlassian.net", {})).toThrow(/Atlassian Cloud/);
  });

  it("rejects URLs that smuggle credentials, ports or paths", () => {
    expect(() => assertJiraBaseUrl("https://user:pw@acme.atlassian.net", {})).toThrow(/credentials/);
    expect(() => assertJiraBaseUrl("https://acme.atlassian.net:8443", {})).toThrow(/port/);
    expect(() => assertJiraBaseUrl("https://acme.atlassian.net/jira", {})).toThrow(/bare host/);
  });

  it("accepts *.atlassian.net over https and normalises to the origin", () => {
    expect(assertJiraBaseUrl("https://acme.atlassian.net", {})).toBe("https://acme.atlassian.net");
    expect(assertJiraBaseUrl("https://ACME-Eng.atlassian.net/", {})).toBe("https://acme-eng.atlassian.net");
  });

  it("accepts only the one host named by JIRA_ALLOW_BASE_HOST", () => {
    const env = { JIRA_ALLOW_BASE_HOST: "jira.internal.example.com" };
    expect(assertJiraBaseUrl("https://jira.internal.example.com", env)).toBe("https://jira.internal.example.com");
    expect(() => assertJiraBaseUrl("https://other.example.com", env)).toThrow(/Atlassian Cloud/);
  });
});

describe("jira adapter configure", () => {
  it("refuses a non-Atlassian baseUrl before any request is made", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      jiraAdapter.configure({ baseUrl: "https://attacker.example.com", email: "e", apiToken: "SECRET", projectKey: "P" }, {}),
    ).rejects.toThrow(/Atlassian Cloud/);
    const res = await jiraAdapter.testConnection();
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the Authorization header only to an accepted Atlassian host", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response("{}", { status: 200 });
      }),
    );
    await jiraAdapter.configure({ baseUrl: "https://acme.atlassian.net", email: "e", apiToken: "t", projectKey: "P" }, {});
    const res = await jiraAdapter.testConnection();
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["https://acme.atlassian.net/rest/api/3/myself"]);
  });
});
