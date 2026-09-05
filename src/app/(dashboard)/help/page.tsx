import { Bell } from "lucide-react";

import { requireUser } from "@/lib/auth/require-role";
import { NAV_ITEMS } from "@/lib/nav-items";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";

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
      "Propensity score (0-100) estimates conversion likelihood from lead source, engagement frequency, profile completeness, and expected investment — shown for context only, it does not affect sort order or Next Best Action.",
      "One-click \"Follow-up\" creates a task; \"Message\" pre-fills the send-message panel on that client's page.",
    ],
  },
  "/dealer-desk": {
    purpose: "The dealer's own view of clients handed off to them for trading execution.",
    bullets: [
      "Shows every client whose Dealer Handoff record is assigned to you, with contact info, current stage, portfolio preference, and trading limits.",
      "You can update the handoff Status and Remarks here — portfolio preferences and trading limits are set by the RM/Manager and can't be edited from this page.",
    ],
  },
  "/clients": {
    purpose: "The master pipeline list, and each client's individual workspace.",
    bullets: [
      "List view: search and filter by stage, priority, SLA status, status, assigned RM, KYC/funding/dealer status, client type, lead source, and created date.",
      "New Client requires a PAN (validated format) and checks for duplicates: a matching PAN or CKYC reference hard-blocks creation — you'll be pointed to the existing record instead; a matching mobile or email is a softer warning you can override with \"Create Anyway\".",
      "Leaving \"Assigned RM\" blank auto-assigns the lead using availability, region/language, HNI eligibility, and workload capacity — the least-loaded eligible RM wins. If nobody qualifies, the client is created unassigned and every Manager/Admin is notified.",
      "Client page is organized into 10 tabs: Overview, Onboarding & KYC, Documents, Activities, Calls/Email/WhatsApp, Tasks, Funds, Dealer Handoff, Notes, and Audit History.",
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
  "/exceptions": {
    purpose: "One queue for everything a manager needs to act on.",
    bullets: [
      "SLA breaches, high-priority overdue clients, KYC rejections, missing next actions, repeated failed contacts, unresolved blockers, and recent stage corrections.",
      "Reassign, create a follow-up, or open the client directly from each row.",
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
      "For RMs: set Availability (Available / On Leave / Unavailable), Regions, Languages, and whether they handle HNI clients — these four feed the lead-routing engine directly.",
      "Marking an RM On Leave or Unavailable automatically reassigns their active clients to another eligible RM (or leaves them unassigned with a notification if nobody qualifies).",
      "Reset a user's password or activate/deactivate their account.",
    ],
  },
  "/settings/integrations": {
    purpose: "Connect Supportify to external services.",
    bullets: [
      "Freshdesk (ticketing), Exotel (calls), Clevertap (profile sync), ClickUp and Jira (two-way task sync), WhatsApp/SMS (messaging), and Resend (email alerts).",
      "Every integration runs in Mock mode until you add live credentials — nothing is blocked in the meantime.",
    ],
  },
  "/settings/account": {
    purpose: "Your own account.",
    bullets: ["Update your name and email.", "Change your sign-in password."],
  },
};

const NOTIFICATIONS_CONTENT = {
  purpose: "The bell icon in the top bar keeps you on top of things without checking every page.",
  bullets: [
    "You're notified on SLA breaches, overdue tasks, new assignments, KYC/funding updates, dealer intro reminders, and more — click one to jump straight to that client.",
    "\"Mark all read\" clears the badge. While the app is open, new SLA breaches also pop up as a live browser notification for RMs and Managers.",
  ],
};

const FAQ_ITEMS: { category: string; question: string; answer: string }[] = [
  {
    category: "Leads & Clients",
    question: "Why do I need a PAN to create a new client?",
    answer:
      "PAN is the unique government ID Supportify uses to catch true duplicate leads before they're created — a matching PAN blocks creation outright rather than just warning you.",
  },
  {
    category: "Leads & Clients",
    question: "A client I'm creating shows \"PAN already belongs to an existing client\" — what do I do?",
    answer:
      "You can't create a second record with the same PAN. Open the existing client from the link shown, or use \"Merge Duplicate\" from that client's Overview tab if it's genuinely a separate duplicate record to combine.",
  },
  {
    category: "Leads & Clients",
    question: "What's the difference between the PAN/CKYC block and the mobile/email warning?",
    answer:
      "PAN and CKYC reference are hard blocks with no override, because they're unique identifiers — two different people can't share one. Mobile/email matches happen for innocent reasons (a shared family number, a typo), so you can review and click \"Create Anyway\" if it's genuinely a new lead.",
  },
  {
    category: "Leads & Clients",
    question: "How does auto-assignment decide which RM gets a new lead?",
    answer:
      "It checks availability first, then filters by region/language if the RM has any set, requires HNI-handling for high-value clients, filters out RMs already at their capacity limit, and hands the lead to whichever eligible RM currently has the fewest active clients.",
  },
  {
    category: "Leads & Clients",
    question: "Why was a new client left unassigned?",
    answer:
      "No RM satisfied every routing rule (available, right region/language, HNI-capable if needed, under capacity). Every Manager and Admin gets notified so it can be assigned manually.",
  },
  {
    category: "Leads & Clients",
    question: "Can I still pick the RM myself?",
    answer: "Yes — the \"Assigned RM\" field on New Client is optional; picking someone there skips auto-assignment entirely.",
  },
  {
    category: "Onboarding pipeline",
    question: "What's the difference between \"Not Interested\" and \"Mark Not Proceeding\"?",
    answer:
      "\"Not Interested\" is a contact outcome you log while recording an RM contact attempt. \"Mark Not Proceeding\" (in Actions) closes the client out of the active pipeline entirely, with a reason — use it once the lead is truly dead.",
  },
  {
    category: "Onboarding pipeline",
    question: "Why is my Submit for KYC button disabled?",
    answer:
      "One or more mandatory documents aren't yet Verified — check the Documents tab. The same completeness check blocks submission until they're resolved, or a Manager/Admin overrides it.",
  },
  {
    category: "Onboarding pipeline",
    question: "The Funds or Dealer Handoff tab says \"Not reached yet\" — why?",
    answer:
      "Those tabs only show their form once the client has reached the relevant stage (or already has a funding/dealer record). Move the client forward in Onboarding & KYC first.",
  },
  {
    category: "Onboarding pipeline",
    question: "What happens to a client's history when I merge a duplicate?",
    answer:
      "All documents, tasks, activity, stage history, and exceptions move onto the surviving record. If both records already have their own KYC/Funding/Dealer record, the merge flags that conflict for manual review instead of silently overwriting one.",
  },
  {
    category: "Activities, Notes & Audit History",
    question: "What's the difference between the Activities, Notes, and Audit History tabs?",
    answer:
      "Activities is the full human-readable timeline — calls, messages, stage changes, everything. Notes is that same timeline filtered to just manual notes. Audit History is the raw, structured before/after record of every state change — the definitive compliance trail.",
  },
  {
    category: "Activities, Notes & Audit History",
    question: "Can I filter the Activities tab?",
    answer:
      "Yes — the category chips above the timeline (All, Note, Stage Change, Call, etc.) filter it instantly; they only show categories that actually have entries for that client.",
  },
  {
    category: "Journeys",
    question: "Why can't I edit a Journey?",
    answer:
      "Editing locks while any client is actively mid-flow in that journey (Running or Waiting) — deactivate it first, or wait for those runs to finish, before changing its structure.",
  },
  {
    category: "Journeys",
    question: "What's the difference between a Condition and a Wait node?",
    answer: "Condition branches the flow immediately based on a true/false check. Wait pauses the flow for a fixed time or until a specific event before continuing.",
  },
  {
    category: "Co-pilot & Reports",
    question: "What do the Health badges (Healthy / At Risk / Critical) mean?",
    answer:
      "They're computed from SLA status, how long the client's been in its current stage, and days since last activity — Critical means several of those are already flagged at once.",
  },
  {
    category: "Co-pilot & Reports",
    question: "Does the SLA clock keep running while a client is on hold?",
    answer:
      "No — time spent in an open exception (on hold / blocked) is excluded from SLA and stage-age calculations, so a legitimately blocked client won't wrongly show as overdue.",
  },
  {
    category: "Admin",
    question: "How do I approve a WhatsApp/SMS template?",
    answer:
      "Create it in Settings > Templates, then set its status to Approved — only Approved templates are selectable when sending manually or from a Journey. WhatsApp templates must also be pre-approved with your provider first.",
  },
  {
    category: "Admin",
    question: "What does \"Mock mode\" mean for an integration?",
    answer:
      "The integration behaves exactly like the real one — tasks sync, messages \"send\", tickets \"create\" — but talks to fake data instead of the live API. Safe for testing until you add real credentials.",
  },
  {
    category: "Admin",
    question: "Who can see what?",
    answer:
      "RMs see only their own assigned clients. Managers and Admins see their whole team via the org hierarchy set in Settings > Users. Journeys, Reports, Exceptions, and most of Settings are Manager/Admin-only.",
  },
];

const FAQ_CATEGORIES = Array.from(new Set(FAQ_ITEMS.map((item) => item.category)));

export default async function HelpPage() {
  const session = await requireUser();
  const visibleItems = NAV_ITEMS.filter(
    (item) => item.roles.includes(session.user.role) && item.href !== "/help",
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Help" description="A quick guide to every part of Supportify you have access to." />

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

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4" />
              Notifications
            </CardTitle>
            <CardDescription>{NOTIFICATIONS_CONTENT.purpose}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {NOTIFICATIONS_CONTENT.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 max-w-2xl">
        <div>
          <h2 className="text-base font-semibold">Frequently asked questions</h2>
          <p className="text-sm text-muted-foreground">Common "why" and "what's the difference" questions, by area.</p>
        </div>

        {FAQ_CATEGORIES.map((category) => (
          <div key={category} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{category}</h3>
            <div className="flex flex-col gap-2">
              {FAQ_ITEMS.filter((item) => item.category === category).map((item) => (
                <details key={item.question} className="group rounded-lg border px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-medium marker:content-none">
                    {item.question}
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
