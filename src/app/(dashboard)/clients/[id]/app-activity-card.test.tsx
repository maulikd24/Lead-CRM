import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/integrations/clevertap/load-app-profile", () => ({ loadAppProfile: vi.fn() }));
import { AppActivityCardSkeleton, AppActivityView } from "./app-activity-card";

const now = new Date("2026-10-09T12:00:00Z");
const html = (result: Parameters<typeof AppActivityView>[0]["result"]) => renderToStaticMarkup(<AppActivityView result={result} now={now} />);

describe("AppActivityView", () => {
  it("maps error kinds to distinct copy", () => {
    expect(html({ error: "x", kind: "not_connected" })).toContain("CleverTap is not connected");
    expect(html({ error: "x", kind: "rejected" })).toContain("CleverTap rejected the request");
    expect(html({ error: "x", kind: "rejected" })).toContain("check the connection in Settings");
    expect(html({ error: "x", kind: "busy" })).toContain("try again shortly".replace("t", "T"));
    const un = html({ error: "x", kind: "unreachable" });
    expect(un).toContain("Couldn&#x27;t reach CleverTap");
    expect(un).not.toContain("rejected");
  });
  it("shows not found", () => expect(html({ found: false })).toContain("No app profile found for this customer"));
  it("renders the found state with the renamed push row and av_ badges only", () => {
    const out = html({ found: true, platforms: ["iOS"], lastSeen: "2026-10-06T12:00:00.000Z", pushEnabled: true, properties: { av_lifecycle_stage: "KYC", Name: "Riya" } });
    expect(out).toContain("Push token registered");
    expect(out).toContain("3 days ago");
    expect(out).toContain("lifecycle stage: KYC");
    expect(out).not.toContain("Riya");
  });
  it("skeleton is busy with a status text", () => {
    const out = renderToStaticMarkup(<AppActivityCardSkeleton />);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Loading app activity");
  });
});
