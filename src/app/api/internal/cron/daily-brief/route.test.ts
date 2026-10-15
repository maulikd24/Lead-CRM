import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
vi.mock("@/lib/security/webhook-auth", () => ({ safeEqual: (a: string | null, b: string | undefined) => a !== null && a === b }));
const brief = vi.hoisted(() => ({ runDailyBrief: vi.fn() }));
vi.mock("@/lib/daily-brief/job", () => brief);

import { POST } from "./route";

const call = (query: string, secret: string | null = "s3cret") =>
  POST(
    new Request(`https://crm.allvest.test/api/internal/cron/daily-brief${query}`, {
      method: "POST",
      headers: secret === null ? {} : { "x-cron-secret": secret },
    }),
  ) as unknown as Promise<{ body: Record<string, unknown>; status: number }>;

describe("POST /api/internal/cron/daily-brief", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    brief.runDailyBrief.mockReset();
    brief.runDailyBrief.mockResolvedValue({ dryRun: true, date: "2026-10-12", results: [], pending: [] });
  });

  it("rejects a call without the cron secret", async () => {
    const res = await call("?dry=1", null);
    expect(res.status).toBe(401);
    expect(brief.runDailyBrief).not.toHaveBeenCalled();
  });

  it("returns 409 for a non-dry call and never sends", async () => {
    const res = await call("");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, reason: "sends happen only from the scheduled job" });
    expect(brief.runDailyBrief).not.toHaveBeenCalled();
  });

  it("returns 409 when dry is set to anything other than 1", async () => {
    const res = await call("?dry=0");
    expect(res.status).toBe(409);
    expect(brief.runDailyBrief).not.toHaveBeenCalled();
  });

  it("runs a dry run for dry=1, passing the RM filter, and never a send", async () => {
    const res = await call("?dry=1&rm=priya@allvest.test");
    expect(res.status).toBe(200);
    expect(brief.runDailyBrief).toHaveBeenCalledWith({ dry: true, rm: "priya@allvest.test" });
    expect(res.body).toMatchObject({ ok: true, dryRun: true });
  });
});
