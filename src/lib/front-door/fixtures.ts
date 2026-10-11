/**
 * Synthetic content for the public front door. Nothing here comes from a database or a real customer: names, dates and
 * counts are invented for illustration and every screen that uses them says so. No performance or return figure belongs here.
 */

export const SYNTHETIC_LABEL = "Synthetic example. Not real customers or numbers.";

export const CUSTOMERS = [
  { id: "c-rahul", name: "Rahul M.", segment: "HNI" },
  { id: "c-meera", name: "Meera S.", segment: "Priority" },
  { id: "c-arjun", name: "Arjun K.", segment: "Growth" },
  { id: "c-neha", name: "Neha P.", segment: "Priority" },
] as const;

// ---- The scroll story -------------------------------------------------------------------------------------------------
export type StoryView = "know" | "hold" | "decide" | "brief" | "call" | "remember";

export const STORY_STEPS: { id: StoryView; kicker: string; title: string; body: string }[] = [
  {
    id: "know",
    kicker: "1  Know",
    title: "Start with the whole customer.",
    body: "Rahul is an HNI client. One screen holds his profile, his open items and what changed lately: a complaint is open and a payment was declined recently.",
  },
  {
    id: "hold",
    kicker: "2  Hold back",
    title: "Hold back what would land badly.",
    body: "Two follow-ups were next in line: a PMS follow-up and a first-trade nudge. The system holds both back and says why: an open complaint and a recent decline.",
  },
  {
    id: "decide",
    kicker: "3  Decide",
    title: "Choose one next step, with its evidence.",
    body: "It chooses Fix the complaint. Open the evidence to see the exact items behind the choice. Nothing is hidden and nothing is sent to the customer.",
  },
  {
    id: "brief",
    kicker: "4  Brief",
    title: "Brief the RM before the call.",
    body: "The RM gets a short brief: what happened, what to say and what to leave out. AI writes the draft. The RM edits it and approves it.",
  },
  {
    id: "call",
    kicker: "5  Listen",
    title: "Understand the call afterwards.",
    body: "The RM calls. Call analysis finds the complaint resolved and an interest in a mutual fund review.",
  },
  {
    id: "remember",
    kicker: "6  Remember",
    title: "Remember, then decide again.",
    body: "Memory updates: the complaint is closed and the interest is noted. A new decision schedules the mutual fund review, for the RM to approve.",
  },
];

export const STORY_DATA = {
  customer: { name: "Rahul M.", segment: "HNI", rm: "Assigned RM", since: "Client since a few years" },
  facts: [
    { label: "Segment", value: "HNI" },
    { label: "Open complaint", value: "1", tone: "warning" as const, hint: "Statement mismatch" },
    { label: "Last payment", value: "Declined", tone: "destructive" as const, hint: "6 days ago" },
    { label: "Consent", value: "On file", tone: "success" as const, hint: "WhatsApp and calls" },
  ],
  signals: [
    { when: "6 days ago", text: "Payment declined on a scheduled order", chip: "Decline" },
    { when: "4 days ago", text: "Complaint raised: statement does not match his records", chip: "Complaint" },
    { when: "Today", text: "No reply yet to the acknowledgement", chip: "Open" },
  ],
  candidates: [
    { action: "PMS follow-up", state: "held" as const, reason: "Open complaint. Do not sell while a complaint is open." },
    { action: "First-trade nudge", state: "held" as const, reason: "Recent decline. Wait until the payment is sorted." },
    { action: "Fix the complaint", state: "chosen" as const, reason: "Open, recent and the customer is waiting." },
  ],
  evidence: [
    { source: "Support ticket", detail: "Statement mismatch, opened 4 days ago, no resolution recorded" },
    { source: "Payment event", detail: "Scheduled order declined 6 days ago" },
    { source: "Consent ledger", detail: "Contact on WhatsApp and calls allowed. Nothing blocks a call." },
    { source: "Freshness", detail: "Checked just now. Every source shows when it was last read." },
  ],
  brief: {
    headline: "Call Rahul about the statement. Resolve first, sell nothing.",
    say: ["Acknowledge the mismatch and apologise for the wait.", "Walk through the corrected statement.", "Ask if anything else is unclear."],
    avoid: ["Do not mention PMS or new products.", "Do not raise the declined payment unless he does."],
    note: "AI draft. The RM edits and approves before anything is used.",
  },
  call: {
    title: "Call analysis",
    summary: "Complaint resolved. Rahul is satisfied with the corrected statement.",
    moments: [
      { at: "02:10", text: "Statement matches after the correction." },
      { at: "05:40", text: "Asks about reviewing his mutual fund holdings." },
    ],
    outcomes: [
      { label: "Complaint", value: "Resolved", tone: "success" as const },
      { label: "Interest", value: "Mutual fund review", tone: "default" as const },
    ],
  },
  memory: [
    { label: "Complaint", before: "Open", after: "Closed" },
    { label: "Interest", before: "Not known", after: "Mutual fund review" },
    { label: "Do not contact about", before: "New products", after: "Cleared" },
  ],
  nextDecision: { action: "Schedule a mutual fund review", state: "Waiting for RM approval", detail: "Proposed for the coming week. Nothing is booked until the RM approves." },
};

// ---- The role switcher ------------------------------------------------------------------------------------------------
export type Tile = { label: string; value: string; hint?: string };
export type RoleHome = {
  title: string;
  lead: string;
  tiles: Tile[];
  listTitle: string;
  rows: { primary: string; secondary: string; chip?: string }[];
  tour: string[];
  syntheticNote: string;
};

export const ROLE_HOME: Record<"rm" | "marketing" | "management" | "admin" | "control-plane", RoleHome> = {
  rm: {
    title: "Today",
    lead: "Your day, in the order that matters.",
    tiles: [
      { label: "Needs attention", value: "3", hint: "Open complaints and due follow-ups" },
      { label: "Calls today", value: "4" },
      { label: "Drafts to approve", value: "2" },
    ],
    listTitle: "Next up",
    rows: [
      { primary: "Rahul M.", secondary: "Fix the complaint. Call brief ready.", chip: "Call" },
      { primary: "Meera S.", secondary: "Documents pending for two days.", chip: "Follow up" },
      { primary: "Arjun K.", secondary: "Waiting for first funding.", chip: "Nudge draft" },
    ],
    tour: ["See who needs you first, with the reason.", "Open a customer and read the evidence.", "Approve or edit every draft before it is sent."],
    syntheticNote: "Synthetic example. Names and counts are invented.",
  },
  marketing: {
    title: "Marketing",
    lead: "Audiences and channels, in aggregate.",
    tiles: [
      { label: "Active campaigns", value: "5" },
      { label: "Spend this month", value: "Shown here only", hint: "RMs never see this" },
      { label: "Leads this week", value: "Aggregated" },
    ],
    listTitle: "Audiences",
    rows: [
      { primary: "Cohort A", secondary: "Referred, high intent. Pseudonymous.", chip: "Aggregate" },
      { primary: "Cohort B", secondary: "Paid social, first-time investors.", chip: "Aggregate" },
      { primary: "Cohort C", secondary: "Webinar attendees. No individual names.", chip: "Aggregate" },
    ],
    tour: ["Plan and review campaigns and creative.", "See channels and cohorts, never individual customers.", "Draft posts. A second person approves them."],
    syntheticNote: "Synthetic example. Cohorts and counts are invented.",
  },
  management: {
    title: "Manager dashboard",
    lead: "The whole team, without opening every record.",
    tiles: [
      { label: "Team pipeline", value: "By stage" },
      { label: "Follow-ups overdue", value: "2" },
      { label: "Drafts waiting", value: "6" },
    ],
    listTitle: "Across the team",
    rows: [
      { primary: "Overdue follow-ups", secondary: "Two RMs have items past their date.", chip: "Review" },
      { primary: "Complaints open", secondary: "One older than three days.", chip: "Escalate" },
      { primary: "Approvals", secondary: "Six drafts are waiting for a person.", chip: "Approve" },
    ],
    tour: ["See pipeline, workload and exceptions in one view.", "Review calls and quality on a sample.", "Approve what needs a second person."],
    syntheticNote: "Synthetic example. Counts are invented.",
  },
  admin: {
    title: "Administration",
    lead: "Who can do what, and a record of it.",
    tiles: [
      { label: "Roles", value: "Defined" },
      { label: "Access registry", value: "Default deny" },
      { label: "Changes", value: "Audited" },
    ],
    listTitle: "Recent changes",
    rows: [
      { primary: "Role assigned", secondary: "A new joiner was given a role.", chip: "Audit" },
      { primary: "Sign-in domain added", secondary: "Company Google sign-in allowed for one domain.", chip: "Audit" },
      { primary: "View as role", secondary: "An admin previewed the RM sidebar. Recorded.", chip: "Audit" },
    ],
    tour: ["Give people a role. Access follows from it.", "Preview what any role sees, without becoming them.", "Read who changed what, and when."],
    syntheticNote: "Synthetic example. Entries are invented.",
  },
  "control-plane": {
    title: "Control plane",
    lead: "Is the system healthy, and what needs a look?",
    tiles: [
      { label: "Health", value: "OK" },
      { label: "Jobs on schedule", value: "All" },
      { label: "Failures to review", value: "0" },
    ],
    listTitle: "Integrations",
    rows: [
      { primary: "Messaging", secondary: "Connected. Last check just now.", chip: "OK" },
      { primary: "Support desk", secondary: "Connected. Last check just now.", chip: "OK" },
      { primary: "Ad platforms", secondary: "Reporting only. Nothing is spent from here.", chip: "OK" },
    ],
    tour: ["Health, jobs, failures and integrations on four tabs.", "Every failure shows what happened and how to retry.", "Switches are visible and changed in one place."],
    syntheticNote: "Synthetic example. Statuses are illustrative.",
  },
};

// ---- Ask Allvest (scripted) -------------------------------------------------------------------------------------------
export const ASK_SCRIPT = [
  {
    id: "why",
    prompt: "Why was Rahul not sent the PMS follow-up?",
    answer: [
      "It was held back for two reasons.",
      "1. There is an open complaint about his statement, opened 4 days ago.",
      "2. A scheduled payment was declined 6 days ago.",
      "The rule: do not sell while a complaint is open. The chosen next step is Fix the complaint.",
    ],
    sources: ["Support ticket", "Payment event", "Decision log"],
  },
  {
    id: "who",
    prompt: "Who has an open complaint and an interest in mutual funds?",
    answer: [
      "Two synthetic customers match.",
      "Rahul M.: complaint resolved on the last call, mutual fund review requested.",
      "Neha P.: complaint open, mutual fund interest noted last month.",
      "Neha's complaint is still open, so any review waits until it is fixed.",
    ],
    sources: ["Customer memory", "Support tickets"],
  },
  {
    id: "draft",
    prompt: "Draft a short note for Rahul's review call.",
    answer: [
      "Draft for the RM to edit. Not sent.",
      "Hello Rahul, thank you for your time today. As discussed, I will set up a short review of your mutual fund holdings next week. Please tell me what time suits you.",
      "Needs RM approval before it goes anywhere.",
    ],
    sources: ["Call analysis", "Consent ledger"],
  },
] as const;

export const ASK_NOTE = "Demo with scripted answers. No AI is called on this page and no customer data is used.";

// ---- Trust strip ------------------------------------------------------------------------------------------------------
export const TRUST = [
  { id: "consent", title: "Consent ledger", body: "Every contact is checked against recorded consent before anything is drafted for sending." },
  { id: "audit", title: "Audit trail", body: "Who changed what, and when, is recorded. The trail is chained so a gap shows." },
  { id: "roles", title: "Role segregation", body: "Access is denied unless a role is granted it. Marketing and RM work do not mix." },
  { id: "humans", title: "AI drafts, people approve", body: "AI prepares drafts and briefs. A person approves anything that reaches a customer." },
] as const;
