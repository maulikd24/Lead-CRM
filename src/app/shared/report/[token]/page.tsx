import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ReportDocument } from "@/components/creative/report-document";
import { directorReportsEnabled } from "@/lib/creative/flags";
import { openShare } from "@/lib/director/db";
import { isWellFormedToken } from "@/lib/director/share";
import { rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing performance report", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 p-6 text-center">
      <h1 className="font-heading text-xl font-bold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </main>
  );
}

/**
 * A shared director report, opened by a link with an unguessable token. No sign-in: the token is the key. It reads a stored
 * snapshot of aggregate numbers (never live customer tables), so it exposes no customer data. A link that is expired or
 * revoked says so in one neutral line; a token that was never issued is a plain 404. Lookups are rate limited per address.
 */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  if (!directorReportsEnabled()) notFound();
  const { token } = await params;
  if (!isWellFormedToken(token)) notFound();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const limit = await rateLimit("report-share", ip, { limit: 60, windowSeconds: 600 });
  if (!limit.allowed) return <Notice title="Too many requests" body="Please wait a few minutes and try the link again." />;
  const share = await openShare(token);
  if (share.state === "not_found") notFound();
  if (share.state !== "open") return <Notice title={share.state === "expired" ? "This link has expired" : "This link has been withdrawn"} body="Ask the person who sent it for a new one." />;
  return <ReportDocument report={share.report} shared expiresAt={share.expiresAt.toISOString()} />;
}
