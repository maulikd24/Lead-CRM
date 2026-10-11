import { can } from "@/lib/access/policy";
import type { Role } from "@/generated/prisma/client";

export type ActionCounts = { approvals: number; overdue: number; dueToday: number; openComplaints: number; latePromises: number };
export type ActionTile = { key: string; label: string; value: number; href: string; tone: "default" | "warning" | "destructive" };

/**
 * The strip at the top of Today: what needs the person, in the order they would act on it. Approvals waiting, overdue work, late
 * promises, open complaints, then what is due today. Each tile exists only where the module is on and the central policy registry lets
 * the role open its screen; a tile coloured only while something is waiting. (The old volume counts, active clients and so on,
 * stay on the full overview.)
 */
export function actionTiles(role: Role, enabledFlags: readonly string[], counts: ActionCounts): ActionTile[] {
  const tiles: ActionTile[] = [];
  const hot = (n: number, tone: "warning" | "destructive") => (n > 0 ? tone : "default");
  if (enabledFlags.includes("approvals-inbox") && can(role, "approvals", "view")) tiles.push({ key: "approvals", label: "Approvals waiting", value: counts.approvals, href: "/approvals", tone: hot(counts.approvals, "warning") });
  const tasks = can(role, "tasks", "view");
  if (tasks) tiles.push({ key: "overdue", label: "Overdue tasks", value: counts.overdue, href: "/tasks", tone: hot(counts.overdue, "destructive") });
  if (enabledFlags.includes("service-state") && can(role, "service-state", "view")) {
    tiles.push({ key: "promises", label: "Late promises", value: counts.latePromises, href: "/service", tone: hot(counts.latePromises, "destructive") });
    tiles.push({ key: "complaints", label: "Open complaints", value: counts.openComplaints, href: "/service", tone: hot(counts.openComplaints, "warning") });
  }
  if (tasks) tiles.push({ key: "due", label: "Due today", value: counts.dueToday, href: "/tasks", tone: "default" });
  return tiles;
}
