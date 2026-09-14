import { requireUser } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Release = {
  date: string;
  bullets: string[];
};

const RELEASES: Release[] = [
  {
    date: "13 September 2026",
    bullets: [
      "New Leads Activity section on Reports: created/updated counts with Daily, Weekly, Monthly, Quarterly, Yearly, and custom date-range filters, plus a CSV export.",
      "A daily email digest of leads created/updated, sent at 9 PM IST to an operator-configured recipient.",
      "RM Performance table rows now link to a full per-RM performance page with its own KPIs, assigned clients, and Leads Activity trend.",
      "Joint account holding: add a Second and Third holder to a client, each with their own KYC documents, plus an Operating Instruction (Jointly / Either or Survivor / Anyone or Survivor).",
      "Clients can now be edited after creation — any field, by any user — and Admins can archive (and restore) a client.",
      "A duplicate mobile number now hard-blocks client creation, the same as PAN and CKYC.",
      "Merge Duplicate is now available to RMs (previously Manager/Admin only), and the Clients list supports selecting several clients to merge at once.",
      "New hold reason: \"Referrer will be connecting with this client.\"",
      "KYC documents can be verified all at once with a new \"Verify All\" action.",
      "Task due dates can be rescheduled directly from the task.",
      "Three new bulk actions on the Clients list: Put On Hold, Mark Not Proceeding, and Export Selected.",
      "Referral Source is now a fixed dropdown of named RM codes (with an \"Other\" free-text fallback), instead of free text.",
      "\"Distributor\" added as a Client Type.",
    ],
  },
  {
    date: "10 September 2026",
    bullets: [
      "PAN is no longer required to create a client — it's still validated and duplicate-checked if you do enter one.",
      "Audit History now renders as a readable, icon-led timeline instead of raw JSON.",
    ],
  },
  {
    date: "6 September 2026",
    bullets: [
      "The Support Handbook moved fully in-app (previously an external document), linked from the Help page.",
      "Fixed the sidebar overlapping wide tables on some pages.",
    ],
  },
  {
    date: "5 September 2026",
    bullets: [
      "A full visual redesign: new design system, dark mode, and a ⌘K / Ctrl+K command palette for fast navigation and search.",
    ],
  },
  {
    date: "4 September 2026",
    bullets: [
      "The client page was restructured into the current six-tab \"Client 360\" layout, with a unified activity timeline.",
      "Added PAN/CKYC duplicate detection and a multi-factor engine that auto-assigns new leads to an RM by region, language, HNI eligibility, and workload capacity.",
      "Added manager analytics — a stage-aging heatmap — and new bulk client tools.",
      "Added lead propensity scoring and a real Dealer Handoff Desk.",
      "Hardened the funding stage gate and added funding-specific SLA automation.",
      "Updated the Help page with current features and FAQs.",
    ],
  },
  {
    date: "30 August 2026",
    bullets: ["Aligned colors, typography, and button shapes with Allvest's brand."],
  },
  {
    date: "29 August 2026",
    bullets: [
      "Added a one-time guided tour for new users, and the first version of the Help page.",
      "Added Next Action tracking, stage gates, and the Exceptions Queue.",
      "Added ClickUp and Jira integrations with two-way task sync.",
      "Reorganized Settings into Account/Profile vs. Apps & Integrations.",
    ],
  },
  {
    date: "27 August 2026",
    bullets: [
      "Simplified the New Client form, collapsed the pipeline to 5 stages, and added the Dealer role.",
      "Added client filter dropdowns and SLA breach alerts (browser and email).",
      "Journeys: node deletion, richer condition operators, and four new action types.",
    ],
  },
  {
    date: "25 August 2026",
    bullets: [
      "Initial launch: lead management, the onboarding pipeline, workflow Journeys, integrations, and messaging.",
      "Rebranded to Supportify with a terracotta and navy visual identity.",
      "Added a rules-based AI co-pilot for RMs and user management.",
    ],
  },
];

export default async function ReleaseNotesPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Release Notes"
        description="What's changed in Supportify over time, newest first."
      />

      <div className="flex flex-col gap-4">
        {RELEASES.map((release) => (
          <Card key={release.date} className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">{release.date}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {release.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
