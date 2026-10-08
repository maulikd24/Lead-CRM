import type { Notification } from "@/generated/prisma/client";

// Pure helpers shared by the in-app bell (client) and the phone-push sender (server). Keep this file free of
// "use client"/React so both sides can import it.

export function describeNotification(notification: Pick<Notification, "type" | "payload">): string {
  const payload = notification.payload as Record<string, unknown>;
  switch (notification.type) {
    case "task_overdue":
      return `Task "${payload.taskTitle}" for ${payload.clientName} is overdue`;
    case "task_overdue_escalation":
      return `${payload.assignedToName}'s task "${payload.taskTitle}" for ${payload.clientName} is overdue`;
    case "stage_sla_breach":
      return payload.escalated
        ? `${payload.assignedToName}'s client ${payload.clientName} is overdue at ${payload.stage}`
        : `${payload.clientName} is overdue at ${payload.stage}`;
    case "document_rejected":
      return `${payload.documentType} rejected for ${payload.clientName}: ${payload.reason}`;
    case "kyc_update":
      return `${payload.clientName}: ${payload.message}`;
    case "kyc_step_failed":
      return `${payload.clientName}: KYC step ${payload.step} failed — ${payload.reason}`;
    case "kyc_step_stalled":
      return `${payload.clientName}'s KYC is stuck at ${payload.step} (${payload.hours}h)`;
    case "kyc_step_escalated":
      return `${payload.assignedToName}'s client ${payload.clientName} has been stuck at ${payload.step} for ${payload.hours}h`;
    case "funding_pending":
      return payload.message ? `${payload.clientName}: ${payload.message}` : `Funding pending for ${payload.clientName}`;
    case "funding_sla_pending_escalation":
      return `${payload.assignedToName}'s client ${payload.clientName} has funding pending ${payload.hoursElapsed}h+ — needs attention`;
    case "new_assignment":
      // Older rows used this type for "left unassigned" too — those carry a `reason`.
      return payload.reason
        ? `New lead ${payload.clientName} has no RM — assign it`
        : `You were assigned client ${payload.clientName}`;
    case "unassigned_lead":
      return payload.reason === "manual_mode"
        ? `New lead ${payload.clientName} is waiting for an RM (assignment is manual)`
        : `New lead ${payload.clientName} couldn't be auto-assigned (no eligible RM) — assign it`;
    case "kyc_approval_pending":
    case "kyc_step_failed":
    case "kyc_step_stalled":
    case "kyc_step_escalated":
      return `KYC for ${payload.clientName} is waiting for your approval`;
    case "lead_reenquiry":
      return `${payload.clientName} enquired again via ${payload.source}`;
    case "service_issue_open":
      return `${payload.clientName} has a service issue: ${payload.text}`;
    case "compliance_flag":
      return `Possible ${String(payload.kind ?? "compliance issue").toLowerCase().replace(/_/g, " ")} on ${payload.clientName}: ${payload.text}`;
    case "agent_handover":
      return `AI handed ${payload.clientName} over to you: ${payload.summary}`;

    case "stage_sla_due_soon":
      return `${payload.clientName} is nearing its SLA at ${payload.stage} — about ${payload.hoursLeft}h left`;
    case "hold_started":
      return `${payload.clientName} put on hold: ${payload.reason}`;
    case "client_reopened":
      return `${payload.clientName} reopened: ${payload.reason}`;
    case "dealer_intro_pending":
      return `${payload.clientName}: ${payload.message}`;
    case "excessive_overdue_workload":
      return `${payload.rmName} has ${payload.overdueCount} overdue tasks`;
    case "journey_notify_manager":
      return String(payload.message ?? `Journey flagged client ${payload.clientName} for review`);
    case "client_disengaged":
      return `${payload.clientName} has had no contact in ${payload.daysSinceLastActivity} days`;
    case "external_task_status_changed":
      return `${payload.taskTitle} (${payload.clientName}) → ${payload.newStatus} via ${payload.provider}`;
    case "bug_report_filed":
      return `${payload.reporterName} reported an issue: ${payload.description}`;
    case "daily_report_send_failed":
      return `Daily leads report email failed to send: ${payload.error}`;
    case "weekly_report_send_failed":
      return `Weekly management report email failed to send: ${payload.error}`;
    case "monthly_report_send_failed":
      return `Monthly management report email failed to send: ${payload.error}`;
    case "inbound_message":
      return `New WhatsApp message from ${payload.clientName}${payload.accountLabel ? ` on ${payload.accountLabel}` : ""}: ${payload.preview ?? ""}`;
    case "whatsapp_offline":
      return `${payload.accountLabel}'s WhatsApp went offline — check the WhatsApp worker`;
    case "audit_chain_broken":
      return `Audit log integrity check failed: ${payload.problemCount} problem(s), first at entry #${payload.firstSeq} (${payload.firstProblem})`;
    case "audit_anchor_mismatch":
      return `Audit log no longer matches its off-site backup: ${payload.problemCount} mismatch(es), first from ${payload.firstDate} (entry #${payload.firstSeq}) — history may have been rewritten`;
    case "audit_anchor_failed":
      return `Daily audit log backup to S3 failed (retrying every few minutes): ${payload.error}`;
    case "quality_review_low_score":
      return payload.escalated
        ? `${payload.assignedToName}'s call/chat with ${payload.clientName} scored low (${payload.qualityScore}) — review needed`
        : `Your conversation with ${payload.clientName} scored low (${payload.qualityScore}) — review it`;
    default:
      return notification.type.replace(/_/g, " ");
  }
}

export type NotificationCategory = "sla_tasks" | "assignments" | "clients_kyc" | "messages" | "system";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  sla_tasks: "SLA & tasks",
  assignments: "Assignments & new leads",
  clients_kyc: "Clients, KYC & funding",
  messages: "Messages & call reviews",
  system: "Reports & system",
};

/** Groups the free-text notification types so users can mute whole categories of phone push. */
export function notificationCategory(type: string): NotificationCategory {
  switch (type) {
    case "stage_sla_due_soon":
    case "stage_sla_breach":
    case "funding_sla_pending_escalation":
    case "task_overdue":
    case "task_overdue_escalation":
    case "excessive_overdue_workload":
      return "sla_tasks";
    case "new_assignment":
    case "unassigned_lead":
    case "lead_reenquiry":
    case "agent_handover":
      return "assignments";
    case "document_rejected":
    case "kyc_update":
    case "kyc_approval_pending":
    case "kyc_step_failed":
    case "kyc_step_stalled":
    case "kyc_step_escalated":
    case "funding_pending":
    case "dealer_intro_pending":
    case "hold_started":
    case "client_reopened":
    case "client_disengaged":
    case "journey_notify_manager":
    case "external_task_status_changed":
      return "clients_kyc";
    case "inbound_message":
    case "quality_review_low_score":
    case "service_issue_open":
    case "compliance_flag":
      return "messages";
    default:
      return "system";
  }
}

/** Where tapping a phone notification should land. */
export function notificationUrl(notification: Pick<Notification, "type" | "payload">): string {
  const payload = notification.payload as Record<string, unknown>;
  if (notification.type === "inbound_message") return "/inbox";
  if (notification.type === "quality_review_low_score" && typeof payload.reviewId === "string") return `/quality-audit/${payload.reviewId}`;
  if (notification.type.startsWith("task_overdue")) return "/tasks";
  if (typeof payload.clientId === "string") return `/clients/${payload.clientId}`;
  if (notification.type === "bug_report_filed") return "/debugger";
  return "/dashboard";
}
