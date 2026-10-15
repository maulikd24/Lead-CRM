import { can, type Area } from "./policy";

/**
 * Which registry area each notification type belongs to. A person sees a notification only if the registry lets their
 * role view that area, so a notification that names a customer can never reach a role that may not open customers (for
 * example marketing). Default deny: a type that is not listed here is shown to ADMIN only. A test fails when the bell
 * can describe a type that is missing from this table.
 */
export const NOTIFICATION_AREA: Record<string, Area> = {
  // Customer work (names a customer)
  agent_handover: "clients",
  client_disengaged: "clients",
  client_reopened: "clients",
  compliance_flag: "clients",
  document_rejected: "clients",
  funding_pending: "clients",
  funding_sla_pending_escalation: "clients",
  hold_started: "clients",
  kyc_approval_pending: "clients",
  kyc_step_escalated: "clients",
  kyc_step_failed: "clients",
  kyc_step_stalled: "clients",
  kyc_update: "clients",
  lead_push: "clients",
  autopilot_digest: "marketing-autopilot",
  lead_reenquiry: "clients",
  lead_sla_breach: "clients",
  lead_returned: "clients",
  new_assignment: "clients",
  stage_sla_breach: "clients",
  stage_sla_due_soon: "clients",
  unassigned_lead: "clients",
  duplicate_review_requested: "duplicates",
  inbound_message: "inbox",
  service_issue_open: "client-support",
  quality_review_low_score: "quality-audit",
  journey_notify_manager: "journeys",
  // Tasks: every task belongs to a customer and its notification names that customer, so it needs customer access
  task_overdue: "clients",
  task_overdue_escalation: "clients",
  excessive_overdue_workload: "clients",
  external_task_status_changed: "clients",
  // Partners and dealers
  dealer_intro_pending: "dealer-desk",
  // Marketing (aggregate only)
  marketing_weekly_digest: "marketing-reports",
  // System and administration
  audit_anchor_failed: "settings-system",
  audit_anchor_mismatch: "settings-system",
  audit_chain_broken: "settings-system",
  control_plane_alert: "control-plane",
  daily_report_send_failed: "settings-system",
  weekly_report_send_failed: "settings-system",
  monthly_report_send_failed: "settings-system",
  whatsapp_offline: "settings-whatsapp",
  bug_report_filed: "debugger",
};

export function notificationAllowed(role: string | null | undefined, type: string): boolean {
  if (role === "ADMIN") return true;
  const area = NOTIFICATION_AREA[type];
  return !!area && can(role, area, "view");
}

/** The Prisma `where` fragment that limits a notification query to what this role may see. ADMIN: no restriction. */
export function notificationVisibleWhere(role: string | null | undefined): { type?: { in: string[] } } {
  if (role === "ADMIN") return {};
  return { type: { in: Object.keys(NOTIFICATION_AREA).filter((t) => notificationAllowed(role, t)) } };
}
