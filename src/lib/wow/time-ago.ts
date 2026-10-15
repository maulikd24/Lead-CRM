/** "just now", "5m ago", "3h ago", "yesterday", "4d ago", then a short date. Pure: the clock is a parameter. */
export function timeAgo(then: Date | string, now: Date = new Date()): string {
  const t = typeof then === "string" ? new Date(then) : then;
  const s = Math.round((now.getTime() - t.getTime()) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export type NotificationKind = "task" | "kyc" | "funding" | "lead" | "message" | "alert" | "other";

/** Groups the many notification types into the handful of icons the bell uses. */
export function notificationKind(type: string): NotificationKind {
  if (type.startsWith("task_") || type.startsWith("stage_sla")) return "task";
  if (type.startsWith("kyc") || type === "document_rejected") return "kyc";
  if (type.startsWith("funding")) return "funding";
  if (type === "new_assignment" || type === "unassigned_lead" || type.startsWith("lead_")) return "lead";
  if (type === "inbound_message" || type === "agent_handover") return "message";
  if (type === "compliance_flag" || type === "service_issue_open") return "alert";
  return "other";
}
