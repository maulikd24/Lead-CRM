import { requireUser } from "@/lib/auth/require-role";
import { NAV_ITEMS } from "@/lib/nav-items";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const HELP_CONTENT: Record<string, { purpose: string; bullets: string[] }> = {
  "/dashboard": {
    purpose: "Your personal landing page.",
    bullets: [
      "KPI strip: Active, New Today, Due Today, Overdue, KYC Pending, Funding Pending, Dealer Intro Pending, Completed.",
      "\"My Action Queue\" lists your pending/overdue tasks with due dates, priority, and SLA status.",
    ],
  },
  "/copilot": {
    purpose: "A prioritized worklist of which clients need attention right now and what to do next.",
    bullets: [
      "Summary strip: Critical, At Risk, Disengaged, and Cross-sell Candidate counts.",
      "Each client shows a Health badge, a Priority score with reasons, and a Next Best Action.",
      "One-click \"Follow-up\" creates a task; \"Message\" pre-fills the send-message panel on that client's page.",
    ],
  },
  "/clients": {
    purpose: "The master pipeline list, and each client's individual workspace.",
    bullets: [
      "List view: search and filter by stage, priority, SLA status, status, assigned RM, KYC/funding/dealer status, client type, lead source, and created date.",
      "Client page: stage-specific action form (contact, documents, KYC, funding, dealer intro), document checklist, activity timeline.",
      "Also on the client page: reassign RM, put on hold / resume, mark not proceeding, reopen, merge duplicates, send WhatsApp/SMS, and a Co-pilot panel with the same Next Best Action logic.",
    ],
  },
  "/tasks": {
    purpose: "Every to-do across your clients in one place.",
    bullets: [
      "Sorted by status then due date, with a one-click \"Mark done\" per row.",
      "New tasks are created from a client's page or from a Co-pilot \"Follow-up\" suggestion — not from this page directly.",
    ],
  },
  "/journeys": {
    purpose: "Build automations that run for you without manual work.",
    bullets: [
      "A Trigger (e.g. Client Created, Stage Changed) starts the flow.",
      "Action nodes do something (send a message/email, create a task, notify a manager, call an integration); Condition nodes branch True/False; Wait nodes pause.",
      "Save persists the graph; Activate/Deactivate turns it on or off. Editing locks while clients are actively mid-flow — deactivate first to make structural changes.",
    ],
  },
  "/reports": {
    purpose: "Pipeline analytics for management oversight.",
    bullets: [
      "KPI strip, Stage Funnel, Stage Conversion, and Bottleneck Analysis (average time per stage).",
      "Lost Reasons, Source Performance (by lead source), and RM Performance tables.",
    ],
  },
  "/settings/stages": {
    purpose: "Configure the onboarding pipeline.",
    bullets: [
      "Set the SLA target (in hours) for each of the 5 fixed stages.",
      "Toggle a stage active/inactive.",
    ],
  },
  "/settings/templates": {
    purpose: "Manage WhatsApp/SMS message templates.",
    bullets: [
      "Create a template with a name, channel, and body (supports {{variable}} placeholders).",
      "Only Approved templates are selectable when sending a message, manually or from a Journey.",
    ],
  },
  "/settings/users": {
    purpose: "User and RM administration.",
    bullets: [
      "Create accounts, set role (Admin/Manager/RM/Dealer), manager, and workload capacity.",
      "Reset a user's password or activate/deactivate their account.",
    ],
  },
  "/settings/integrations": {
    purpose: "Connect Supportify to external services.",
    bullets: [
      "Freshdesk (ticketing), Exotel (calls), Clevertap (profile sync), WhatsApp/SMS (messaging), and Resend (email alerts).",
      "Every integration runs in Mock mode until you add live credentials — nothing is blocked in the meantime.",
    ],
  },
  "/settings/account": {
    purpose: "Your own account.",
    bullets: ["Update your name and email.", "Change your sign-in password."],
  },
};

export default async function HelpPage() {
  const session = await requireUser();
  const visibleItems = NAV_ITEMS.filter(
    (item) => item.roles.includes(session.user.role) && item.href !== "/help",
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Help</h1>
        <p className="text-sm text-muted-foreground">
          A quick guide to every part of Supportify you have access to.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {visibleItems.map((item) => {
          const content = HELP_CONTENT[item.href];
          if (!content) return null;
          return (
            <Card key={item.href} className="max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <item.icon className="size-4" />
                  {item.label}
                </CardTitle>
                <CardDescription>{content.purpose}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {content.bullets.map((bullet, i) => (
                    <li key={i}>{bullet}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
