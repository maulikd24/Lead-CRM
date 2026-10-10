import { afterEach, describe, expect, it, vi } from "vitest";
import { clevertapAdapter } from "./clevertap";

const client = { id: "c1", name: "Test", email: "t@example.com", mobile: null, status: "ACTIVE" } as never;
const creds = { accountId: "acc-test", passcode: "pass-test" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("clevertap adapter syncProfile (profile data is owned by the app)", () => {
  it("is a no-op in every region and flag state: no network call, no Name/Email/Phone upload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const region of ["in1", "eu1", ""]) {
      for (const flag of ["1", undefined]) {
        if (flag === undefined) vi.stubEnv("CLEVERTAP_PUSH_ENABLED", undefined as never);
        else vi.stubEnv("CLEVERTAP_PUSH_ENABLED", flag);
        await clevertapAdapter.configure({ ...creds, region }, {});
        const res = await clevertapAdapter.actions.syncProfile(client, {});
        expect(res).toMatchObject({ success: true, data: { skipped: true, reason: expect.stringMatching(/owned by the app/i) } });
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
