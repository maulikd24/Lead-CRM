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
  it("is two named navigation landmarks: the workspaces rail and the active workspace's pages", () => {
    expect(out).toContain('aria-label="Workspaces"');
    expect(out).toContain('aria-label="Team pages"');
  });
  it("lists the manager's workspaces in order, labelled, and marks the active one", () => {
    const labels = ["Today", "Customers", "Team"].map((l) => out.indexOf(`>${l}<`));
    expect(labels.every((i) => i > 0)).toBe(true);
    expect([...labels].sort((a, b) => a - b)).toEqual(labels);
    expect(out).not.toContain(">Growth<");
    expect(out).toMatch(/aria-current="true"[^>]*aria-label="Team"|aria-label="Team"[^>]*aria-current="true"|aria-current="true"[^>]*title="Team"/);
  });
  it("groups the panel under small uppercase group labels and shows the manager's team pages", () => {
    expect(out).toContain("uppercase");
    expect(out).toContain("Manager Dashboard");
    expect(out).toContain("Customer Intelligence");
    expect(out).not.toContain("Customers pages");
  });
  it("marks the current page for assistive tech", () => {
    expect(out).toMatch(/href="\/management-dashboard"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/management-dashboard"/);
  });
  it("shows rail count badges (99+ past two digits) and says what they count to assistive tech", () => {
    // Inbox now lives in Today, so its replies and the tasks add up on one rail icon.
    expect(out).toContain(">99+<");
    expect(out).toContain("Today, 123 waiting");
    const small = render(true, { "/inbox": 3 });
    expect(small).toContain(">3<");
    expect(small).toContain("Today, 3 waiting");
  });
  it("has no badge when nothing is waiting", () => {
    const quiet = render(true, {});
    expect(quiet).not.toContain("waiting");
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
