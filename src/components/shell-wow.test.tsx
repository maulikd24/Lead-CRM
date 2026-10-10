import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/management-dashboard", useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(dashboard)/actions", () => ({ logoutAction: async () => {} }));
vi.mock("@/app/(dashboard)/notifications-actions", () => ({ markNotificationReadAction: async () => {}, markAllNotificationsReadAction: async () => {}, getRecentNotificationsAction: async () => [] }));
vi.mock("@/components/device-sync/push-token-field", () => ({ PushTokenField: () => null }));

import { AppSidebar } from "./app-sidebar";
import { NotificationsBell } from "./notifications-bell";
import { SidebarProvider } from "./ui/sidebar";

const render = (open = true, counts: Record<string, number> = { "/inbox": 3, "/tasks": 120 }) =>
  renderToString(
    <SidebarProvider defaultOpen={open}>
      <AppSidebar user={{ name: "Mia Manager", email: "m@x.test", role: "MANAGER" }} flags={[]} counts={counts} />
    </SidebarProvider>,
  );

describe("sidebar", () => {
  const out = render();
  it("is a named navigation landmark", () => {
    expect(out).toContain('aria-label="Main"');
  });
  it("groups items under small uppercase section labels that are buttons with an expanded state", () => {
    expect(out).toContain("Overview");
    expect(out).toContain("Insights");
    expect(out).toMatch(/<button[^>]*aria-expanded="(true|false)"[^>]*aria-controls="nav-section-/);
    expect(out).toContain("uppercase");
  });
  it("keeps the working sections open, and folds the long admin list away from the tab order", () => {
    expect(out).toMatch(/id="nav-section-insights"[^>]*data-open="true"/);
    expect(out).toMatch(/id="nav-section-customers"[^>]*data-open="true"/);
    expect(out).toMatch(/id="nav-section-administration"[^>]*data-open="false"[^>]*inert/);
  });
  it("lists the five working sections in order, with the product's own words", () => {
    const labels = ["Customers", "Sales and marketing", "Service", "Insights and AI"].map((l) => out.indexOf(l));
    expect(labels.every((i) => i > 0)).toBe(true);
    expect([...labels].sort((a, b) => a - b)).toEqual(labels);
  });
  it("marks the current page, for the lime indicator and for assistive tech", () => {
    expect(out).toMatch(/data-active[^>]*href="\/management-dashboard"|href="\/management-dashboard"[^>]*data-active/);
  });
  it("shows count badges (99+ past two digits) and says what they count to assistive tech", () => {
    expect(out).toContain(">3<");
    expect(out).toContain(">99+<");
    expect(out).toContain("3 unread conversations");
    expect(out).toContain("120 overdue tasks");
  });
  it("has no badge when nothing is waiting", () => {
    const quiet = render(true, {});
    expect(quiet).not.toContain("unread conversations");
  });
  it("has an avatar and role footer and a sign out button", () => {
    expect(out).toContain("Mia Manager");
    expect(out).toContain(">Manager<");
    expect(out).toContain("Sign out");
  });
  it("collapses to an icon rail that the provider remembers", () => {
    expect(render(false)).toContain('data-state="collapsed"');
    expect(out).toContain('data-state="expanded"');
  });
});

describe("notification bell", () => {
  it("names itself with the unread count and shows a dot only when something is unread", () => {
    const some = renderToString(<NotificationsBell unreadCount={4} />);
    expect(some).toContain('aria-label="Notifications, 4 unread"');
    expect(some).toContain("bellDot");
    const none = renderToString(<NotificationsBell unreadCount={0} />);
    expect(none).toContain('aria-label="Notifications"');
    expect(none).not.toContain("bellDot");
  });
  it("is a popover trigger, not a menu", () => {
    expect(renderToString(<NotificationsBell unreadCount={1} />)).toMatch(/aria-haspopup="dialog"/);
  });
});
