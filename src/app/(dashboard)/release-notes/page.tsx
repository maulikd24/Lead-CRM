import { requireUser } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Release = {
  date: string;
  bullets: string[];
};

const RELEASES: Release[] = [
  {
    date: "20 September 2026",
    bullets: [
      "New RM Daily Report: a personal daily summary for every RM — client activity, progress, funds, blockers, and tomorrow's priorities — viewable on their performance page, downloadable as a PDF, and emailed to them automatically each evening.",
      "New Opportunities tab on the client page: track interest in specific products (mutual funds, broking, PMS, and more) through a pipeline from identified to invested, with a running total pipeline value.",
      "New Wealth tab on the client page: portfolio holdings, asset allocation, a concentration-risk check, a Wealth Health Checkup workflow, and a Smart Allvest risk-profiling workflow.",
      "New Manager Dashboard: one page combining organization KPIs, lead activity trends, detailed team performance (including who's on hold), RM performance, and a clickable pipeline view — with its own PDF export. This replaces the earlier Executive Dashboard, which is now folded in here.",
      "RM performance pages now break results into Activity, Journey, and Business categories, with a placeholder for relationship-quality tracking once that's built.",
      "Added weekly (Monday) and monthly (1st of the month) management report emails alongside the existing daily one.",
      "Fixed the Reports page's PDF export cutting off several sections partway through — every section now downloads in full.",
    ],
  },
  {
    date: "19 September 2026",
    bullets: [
      "Reports charts are now clickable — click a bar in Leads Activity or the Stage Funnel to see the exact filtered list of clients behind that number, including which RM they're assigned to and when they were last updated.",
      "Fixed onboarding stages and several Reports sections showing up completely empty in production; they now show a clear message instead of blank space if this ever happens again.",
      "Joint account holders can no longer be added, edited, or removed once a client has an active trading account.",
      "Put On Hold is now restricted to Managers and Admins, so an RM can no longer pause their own SLA clock.",
      "Logging a note on a client now also marks that client's open tasks as done, the same way completing a task already logged a note.",
      "The Stage Funnel now includes a \"Lost\" bucket for clients marked Not Proceeding.",
      "Merging duplicate clients now also transfers their trading account and revenue history onto the surviving record.",
    ],
  },
  {
    date: "17 September 2026",
    bullets: [
      "Clients can now be permanently deleted (not just archived) — request it from the client page, a different Admin approves it, then an Admin executes it with a type-to-confirm step. Only allowed for clients with no trading, household, or revenue history on file; anything with real financial history still needs Archive instead.",
      "Two new bulk actions on the Clients list: Bulk Edit (Priority, Region, and other lead/profile fields across every selected client at once) and Add Note (one note to every selected client).",
    ],
  },
  {
    date: "15 September 2026",
    bullets: [
      "New Earnings Engine: sync revenue automatically from existing transactions or import it by CSV, compute partner commission accruals against configurable rules, and build Payout Runs that require a different Admin's approval before they take effect.",
      "A payout run moves through Draft, Pending Approval, Approved, and Finalized — every payout traces all the way back to the exact revenue and transaction it came from.",
      "Manual commission adjustments (clawbacks/corrections) always require approval before they change a payout.",
      "The Finance Console now shows a real reconciliation queue of approved payouts awaiting confirmation, plus the same approval queue available in Settings.",
      "The Management Console now shows each partner's lifetime commission accrued alongside the team roster.",
      "Field masking is now live: Partner Home's Referred Clients panel masks PAN for Partners and mobile/email too for Affiliates.",
      "A Manager's stage correction now requires Admin approval before it takes effect; an Admin's own correction still applies immediately.",
      "New Settings pages: Approval Workflows (the maker-checker queue), Data Privacy (masking rules, access log, retention/erasure requests), and Partner Directory.",
      "Partner PAN and GSTIN are now stored encrypted, with a masked-by-default \"Reveal\" control that logs who viewed them.",
      "Accounts are now locked for 15 minutes after 5 consecutive failed sign-in attempts, and every attempt is recorded.",
      "Added a Debugger: report an issue from anywhere in the app via the bug icon in the header; Admins get notified immediately and triage a queue at Debugger.",
      "Fixed a bug where the daily leads-report email could silently fail to send with no visible sign anything went wrong.",
    ],
  },
  {
    date: "14 September 2026",
    bullets: [
      "Five new roles alongside the existing ones — Team Manager, Partner, Affiliate, Distributor, and Finance — each with their own home page and sidebar, with no change to how Admin/Manager/RM/Dealer behave.",
      "Partner Home: a Partner/Affiliate/Distributor's own profile and the clients they've referred.",
      "Households: group existing clients into a family unit and see their combined portfolio.",
      "Trading Accounts, Holdings, and Transactions: a real brokerage/demat account per client, with holdings and transaction history importable by CSV.",
    ],
  },
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
