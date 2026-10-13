// Minimal SendGrid v3 Mail Send client over fetch. The brief is the only sender that uses it, so there is
// no SDK dependency. Key comes from SENDGRID_API_KEY, the sender from BRIEF_FROM, both read by the caller.

export const SENDGRID_SEND_URL = "https://api.sendgrid.com/v3/mail/send";

export type Sender = { email: string; name?: string };

export type BriefEmail = { to: string; subject: string; html: string; text: string };

/** Accepts "Allvest CRM <crm@allvest.co>" or a bare "crm@allvest.co". */
export function parseSender(from: string): Sender {
  const m = from.trim().match(/^"?([^"<]*?)"?\s*<([^<>\s]+)>$/);
  if (!m) return { email: from.trim() };
  const name = m[1].trim();
  return name ? { email: m[2], name } : { email: m[2] };
}

export async function sendBriefEmail(
  mail: BriefEmail,
  cfg: { apiKey: string; from: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: string | null }> {
  const res = await fetchImpl(SENDGRID_SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: mail.to }] }],
      from: parseSender(cfg.from),
      subject: mail.subject,
      content: [
        { type: "text/plain", value: mail.text },
        { type: "text/html", value: mail.html },
      ],
    }),
  });
  // SendGrid answers 202 Accepted with an empty body on success.
  if (res.status !== 202) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`SendGrid responded ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return { messageId: res.headers.get("x-message-id") };
}
