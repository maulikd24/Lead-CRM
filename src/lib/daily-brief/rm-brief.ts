// Builds the daily RM brief email (HTML + plain text) for one RM.
// Pure function: no I/O, no database, no clock. The caller decides which clients go in each section
// and supplies the app base URL, so every link comes from configuration (never a hardcoded domain).

export type BriefClient = {
  id: string;
  name: string;
  phone: string | null;
  /** Stage name as configured in the Stage table (e.g. "Submitted for KYC"). */
  stage: string;
  source: string | null;
  slaDueAt: Date | null;
  createdAt: Date;
};

export type BriefInput = {
  rmName: string;
  dateLabel: string; // e.g. "Tue, 13 Oct"
  appUrl: string; // configured app base URL, e.g. https://crm.example.com (no trailing slash needed)
  overdue: BriefClient[];
  dueToday: BriefClient[];
  newLeads: BriefClient[];
};

export type BriefResult = { subject: string; html: string; text: string; total: number };

/** What the RM should do next at each stage (keeps RM effort minimal). Keyed by the Stage table name. */
export const NEXT_ACTION: Record<string, string> = {
  "New Lead": "First call: introduce Allvest and qualify",
  "Submitted for KYC": "Help close KYC by checking pending documents",
  "KYC completed": "Get the account funded",
  "Pushed for funds": "Follow up on the funds transfer",
  "Introduction with Dealer": "Hand off to Dealer and set a review call",
};

const FALLBACK_ACTION = "Follow up";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const waLink = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${intl}`;
};

const timeIST = (d: Date) =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

function baseOf(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

function section(title: string, accent: string, rows: BriefClient[], appUrl: string, showDue: boolean) {
  if (!rows.length) return "";
  const items = rows
    .map((c) => {
      const action = NEXT_ACTION[c.stage] ?? FALLBACK_ACTION;
      const due = showDue && c.slaDueAt ? ` · due ${timeIST(c.slaDueAt)}` : "";
      const contact = c.phone
        ? `<br/><a href="tel:${esc(c.phone)}" style="color:#1f6f54;text-decoration:none;">Call</a>` +
          ` · <a href="${waLink(c.phone)}" style="color:#1f6f54;text-decoration:none;">WhatsApp</a>`
        : "";
      return `
        <tr><td style="padding:12px 0;border-bottom:1px solid #ece9e2;">
          <a href="${appUrl}/clients/${encodeURIComponent(c.id)}" style="font-weight:600;color:#141816;text-decoration:none;font-size:15px;">${esc(c.name)}</a>
          <span style="font-size:12px;color:#6b6f6c;"> · ${esc(c.stage)}${due}</span><br/>
          <span style="font-size:14px;color:#2b2f2d;">${esc(action)}</span>
          <span style="font-size:13px;">${contact}</span>
        </td></tr>`;
    })
    .join("");
  return `
    <tr><td style="padding:24px 0 4px;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${accent};margin-right:8px;"></span>
      <span style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b6f6c;font-weight:600;">${title} (${rows.length})</span>
    </td></tr>
    <tr><td><table width="100%" cellpadding="0" cellspacing="0">${items}</table></td></tr>`;
}

export function buildBrief(i: BriefInput): BriefResult {
  const total = i.overdue.length + i.dueToday.length + i.newLeads.length;
  const first = i.rmName.trim().split(/\s+/)[0] || "there";
  const base = baseOf(i.appUrl);
  const subject =
    i.overdue.length > 0
      ? `Your day: ${total} clients, ${i.overdue.length} overdue · ${i.dateLabel}`
      : `Your day: ${total} clients to move forward · ${i.dateLabel}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:24px 12px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td style="font-size:12px;color:#6b6f6c;letter-spacing:.08em;text-transform:uppercase;">Allvest · Daily brief · ${esc(i.dateLabel)}</td></tr>
      <tr><td style="padding-top:8px;font-size:22px;font-weight:600;color:#141816;">Good morning, ${esc(first)}.</td></tr>
      <tr><td style="padding-top:6px;font-size:15px;color:#2b2f2d;">
        ${total} client${total === 1 ? "" : "s"} need you today.
        ${i.overdue.length ? `Start with the <b>${i.overdue.length} overdue</b>.` : "Nothing overdue, so keep the momentum going."}
      </td></tr>
      ${section("Overdue", "#c2410c", i.overdue, base, true)}
      ${section("Due today", "#b45309", i.dueToday, base, true)}
      ${section("New leads (last 24h)", "#1f6f54", i.newLeads, base, false)}
      <tr><td style="padding-top:28px;">
        <a href="${base}/clients" style="display:inline-block;background:#141816;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;">Open my clients</a>
      </td></tr>
      <tr><td style="padding-top:20px;font-size:12px;color:#9a9d9b;">Sent automatically at 9:00 AM IST, Mon–Sat. Update stages in the CRM and tomorrow's brief updates on its own.</td></tr>
    </table>
  </td></tr></table></body></html>`;

  const line = (c: BriefClient) => `- ${c.name} (${c.stage}): ${NEXT_ACTION[c.stage] ?? FALLBACK_ACTION}`;
  const text = [
    `Good morning, ${first}. ${total} clients need you today.`,
    i.overdue.length ? `\nOVERDUE\n${i.overdue.map(line).join("\n")}` : "",
    i.dueToday.length ? `\nDUE TODAY\n${i.dueToday.map(line).join("\n")}` : "",
    i.newLeads.length ? `\nNEW LEADS\n${i.newLeads.map(line).join("\n")}` : "",
    `\nOpen: ${base}/clients`,
  ].join("\n");

  return { subject, html, text, total };
}
