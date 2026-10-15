"use client";

import Link from "next/link";
import { useState } from "react";
import { Copy, Link2, Mail, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneSheet, motion } from "@/components/workspace";
import type { DirectorReport } from "@/lib/director/report";
import { formatCount, formatMoney } from "@/lib/marketing/view-model";

import { approveDigestAction, createShareAction, decideShareAction, discardDigestAction, revokeShareAction, saveApprovalSettingsAction, saveDigestSettingsAction } from "./report-actions";
import { Labelled, StatusLine, areaClass, fieldClass, useAction } from "./creative-ui";

export type ShareRow = { id: string; label: string | null; periodFrom: string; periodTo: string; expiresAt: string; viewCount: number; state: "open" | "expired" | "revoked" | "pending"; createdByMe: boolean; decisionNote: string | null };
export type ApprovalSettingsView = { adCreativeFourEyes: boolean; reportFourEyes: boolean };
export type DigestRow = { id: string; weekStart: string; subject: string; bodyText: string; recipients: string[]; status: string };

const NA = "Not available";

function Summary({ report }: { report: DirectorReport }) {
  const t = report.totals.current;
  const money = (n: number | null) => (n === null ? NA : formatMoney(n, report.currency));
  const cnt = (n: number | null) => (n === null ? NA : formatCount(n));
  const delta = (d?: { abs: number; pct: number | null }) => (d ? ` (${d.abs > 0 ? "+" : d.abs < 0 ? "-" : ""}${d.pct !== null ? `${Math.abs(Math.round(d.pct))}%` : `${Math.abs(d.abs)}`})` : "");
  return (
    <div className={`${motion.enter} flex flex-col gap-3 text-sm`}>
      {!report.hasData ? <p role="note" className="rounded-lg border border-border p-3">Not enough connected data for this period. No figures are shown rather than estimated ones.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["Funded customers", cnt(t.funded) + delta(report.totals.delta?.funded)], ["Revenue booked", money(t.revenue) + delta(report.totals.delta?.revenue)], ["Ad spend", money(t.spend) + delta(report.totals.delta?.spend)], ["Cost per funded", money(t.costPerFunded) + delta(report.totals.delta?.costPerFunded)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
            ))}
          </dl>
          {([["What went well", report.wins], ["Watch", report.risks], ["Suggested next steps", report.nextActions]] as const).map(([title, items]) => items.length > 0 && (
            <section key={title} aria-label={title}><h2 className="mb-1 font-heading text-sm font-semibold">{title}</h2><ul className="flex list-disc flex-col gap-1 pl-5">{items.map((i) => <li key={i}>{i}</li>)}</ul></section>
          ))}
          <p className="text-xs text-muted-foreground">Data: {report.freshness.map((f) => `${f.label} ${f.ageHours === null ? "no sync time" : f.channel === "meta" || f.channel === "google" ? `synced ${f.ageHours < 48 ? `${f.ageHours}h` : `${Math.round(f.ageHours / 24)}d`} ago` : "live"}${f.stale ? " (stale)" : ""}`).join(" · ")}. The full report is on the printable page.</p>
        </>
      )}
    </div>
  );
}

function ShareCreator({ from, to }: { from: string; to: string }) {
  const { run, pending, message } = useAction();
  const [days, setDays] = useState(7);
  const [label, setLabel] = useState("");
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Labelled label="Link works for" htmlFor="sh-days"><select id="sh-days" className={fieldClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}</select></Labelled>
        <Labelled label="Label (optional)" htmlFor="sh-label" className="min-w-40 flex-1"><input id="sh-label" className={fieldClass} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="For the board pack" /></Labelled>
        <Button size="sm" disabled={pending} onClick={() => run(() => createShareAction({ from, to, expiryDays: days, label }), "Link created. It opens only after a person approves it.", (r) => { setLink({ url: `${window.location.origin}${r.path}`, expires: r.expiresAt }); setCopied(false); })}><Link2 aria-hidden className="size-4" /> Create share link</Button>
      </div>
      {link && (
        <div role="status" className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
          <p><strong className="font-medium">Copy this link now: it is shown only once.</strong> Anyone with it can read this report (totals only, no customer data) until {new Date(link.expires).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST, or until you revoke it.</p>
          <div className="flex items-center gap-2"><input readOnly aria-label="Share link" className={fieldClass} value={link.url} onFocus={(e) => e.currentTarget.select()} /><Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard?.writeText(link.url); setCopied(true); }}><Copy aria-hidden className="size-4" /> {copied ? "Copied" : "Copy"}</Button></div>
        </div>
      )}
      <StatusLine message={message} />
    </div>
  );
}

function PendingShare({ s, fourEyes }: { s: ShareRow; fourEyes: boolean }) {
  const { run, pending, message } = useAction();
  const [confirmed, setConfirmed] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const blocked = fourEyes && s.createdByMe;
  return (
    <div className="flex w-full flex-col gap-1.5 border-t border-border pt-1.5 text-xs">
      {blocked ? <p role="note" className="text-muted-foreground">A second person has to approve this link: you made it. You can decline it, or ask a colleague to approve it in Approvals.</p> : (
        <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have read the report and it is fit to share</label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!blocked && <Button size="xs" disabled={pending || !confirmed} onClick={() => run(() => decideShareAction(s.id, "approve", { confirmed }), "Approved. The link now opens.")}>Approve and publish</Button>}
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => setDeclining((v) => !v)} aria-expanded={declining}>Decline</Button>
      </div>
      {declining && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => decideShareAction(s.id, "decline", { reason }), "Declined. The link will never open."); }}>
          <Labelled label="Reason" htmlFor={`dc-${s.id}`} className="min-w-40 flex-1"><input id={`dc-${s.id}`} className={fieldClass} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} required /></Labelled>
          <Button type="submit" size="xs" disabled={pending || !reason.trim()}>Decline link</Button>
        </form>
      )}
      <StatusLine message={message} />
    </div>
  );
}

const STATE_LABEL: Record<ShareRow["state"], string> = { open: "Open", expired: "Expired", revoked: "Revoked", pending: "Awaiting approval" };

function Shares({ shares, fourEyes }: { shares: ShareRow[]; fourEyes: boolean }) {
  const { run, pending, message } = useAction();
  if (shares.length === 0) return <p className="text-xs text-muted-foreground">No links yet.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1.5 text-sm">
        {shares.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
            <span className="min-w-0"><span className="block truncate font-medium">{s.label || `${s.periodFrom} to ${s.periodTo}`}</span><span className="block text-xs text-muted-foreground">{s.periodFrom} to {s.periodTo} · {s.viewCount} view{s.viewCount === 1 ? "" : "s"} · expires {new Date(s.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}{s.state === "revoked" && s.decisionNote ? ` · declined: ${s.decisionNote}` : ""}</span></span>
            <span className="flex items-center gap-1.5"><Badge variant={s.state === "open" ? "success" : s.state === "pending" ? "warning" : "outline"}>{STATE_LABEL[s.state]}</Badge>{s.state === "open" && <Button size="xs" variant="outline" disabled={pending} onClick={() => confirm("Revoke this link? It stops working at once.") && run(() => revokeShareAction(s.id), "Link revoked.")}>Revoke</Button>}</span>
            {s.state === "pending" && <PendingShare s={s} fourEyes={fourEyes} />}
          </li>
        ))}
      </ul>
      <StatusLine message={message} />
    </div>
  );
}

function Digests({ digests, settings, approvals, canManage }: { digests: DigestRow[]; settings: { enabled: boolean; recipients: string[] }; approvals: ApprovalSettingsView; canManage: boolean }) {
  const { run, pending, message } = useAction();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [recipients, setRecipients] = useState(settings.recipients.join("\n"));
  const [copyFourEyes, setCopyFourEyes] = useState(approvals.adCreativeFourEyes);
  const [reportFourEyes, setReportFourEyes] = useState(approvals.reportFourEyes);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">Every Monday after 7 am India time the system prepares a summary of the last full week as an in-app notice and a draft email. It never sends anything: you read it, approve it, and send it yourself.</p>
      {digests.length === 0 ? <p className="text-xs text-muted-foreground">No digest has been prepared yet.</p> : (
        <ul className="flex flex-col gap-2">
          {digests.map((d) => (
            <li key={d.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{d.subject}</span><Badge variant={d.status === "APPROVED" ? "success" : d.status === "DRAFT" ? "warning" : "outline"}>{d.status === "DRAFT" ? "Draft: not sent" : d.status === "APPROVED" ? "Approved" : "Discarded"}</Badge></div>
              <details><summary className="cursor-pointer text-xs text-muted-foreground">Read the draft</summary><pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{d.bodyText}</pre></details>
              {d.status !== "DISCARDED" && (
                <div className="flex flex-wrap items-center gap-2">
                  {d.status === "DRAFT" && <Button size="xs" disabled={pending} onClick={() => run(() => approveDigestAction(d.id), "Approved. Send it from your own mail.")}>Approve</Button>}
                  {d.status === "DRAFT" && <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => discardDigestAction(d.id), "Discarded.")}>Discard</Button>}
                  {d.status === "APPROVED" && <Button size="xs" variant="outline" render={<a href={`mailto:${d.recipients.join(",")}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.bodyText.replace(/^DRAFT FOR APPROVAL[^\n]*\n\n/, ""))}`} />}><Mail aria-hidden className="size-3.5" /> Open in my mail app</Button>}
                  <span className="text-xs text-muted-foreground">To: {d.recipients.length ? d.recipients.join(", ") : "no recipients set"}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form className="flex flex-col gap-2 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const a = await saveDigestSettingsAction({ enabled, recipients }); return a.ok ? saveApprovalSettingsAction({ adCreativeFourEyes: copyFourEyes, reportFourEyes }) : a; }, "Settings saved."); }}>
          <h2 className="font-heading text-sm font-semibold">Settings (Admin)</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Prepare the weekly digest</label>
          <fieldset className="flex flex-col gap-1.5"><legend className="text-xs font-medium">A second person must approve</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={copyFourEyes} onChange={(e) => setCopyFourEyes(e.target.checked)} /> Ad copy (its author may not approve it)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reportFourEyes} onChange={(e) => setReportFourEyes(e.target.checked)} /> Report links (their maker may not approve them)</label>
          </fieldset>
          <Labelled label="Recipients (one email address per line)" hint="They are written into the draft. People who are Admin or marketing users also get an in-app notice." htmlFor="dg-rec"><textarea id="dg-rec" rows={3} className={areaClass} value={recipients} onChange={(e) => setRecipients(e.target.value)} /></Labelled>
          <Button type="submit" size="sm" className="self-start" disabled={pending}>Save</Button>
        </form>
      ) : <p className="text-xs text-muted-foreground">Recipients and the on or off setting are managed by an Admin.</p>}
      <StatusLine message={message} />
    </div>
  );
}

export function ReportsView({ report, period, shares, digests, digestSettings, approvalSettings, canManage, printHref }: { report: DirectorReport; period: { key: "week" | "30d" | "custom"; from: string; to: string }; shares: ShareRow[]; digests: DigestRow[]; digestSettings: { enabled: boolean; recipients: string[] }; approvalSettings: ApprovalSettingsView; canManage: boolean; printHref: string }) {
  const link = (key: string) => `/marketing?tab=reports&rp=${key}`;
  const pill = (key: "week" | "30d", label: string) => <Button size="sm" variant={period.key === key ? "default" : "outline"} render={<Link href={link(key)} scroll={false} aria-current={period.key === key ? "page" : undefined} />}>{label}</Button>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {pill("week", "Last full week")}
        {pill("30d", "Last 30 days")}
        <form className="flex flex-wrap items-center gap-1.5" action="/marketing" method="get" aria-label="Custom period">
          <input type="hidden" name="tab" value="reports" /><input type="hidden" name="rp" value="custom" />
          <input type="date" name="rfrom" aria-label="From" className={`${fieldClass} w-36`} defaultValue={period.key === "custom" ? period.from : ""} required />
          <input type="date" name="rto" aria-label="To" className={`${fieldClass} w-36`} defaultValue={period.key === "custom" ? period.to : ""} required />
          <Button type="submit" size="sm" variant={period.key === "custom" ? "default" : "outline"}>Custom</Button>
        </form>
        <Button size="sm" variant="outline" render={<Link href={printHref} target="_blank" />}><Printer aria-hidden className="size-4" /> Printable page</Button>
      </div>
      <p className="text-xs text-muted-foreground">{report.period.from} to {report.period.to}{report.comparePeriod ? `, compared with ${report.comparePeriod.from} to ${report.comparePeriod.to}` : ""}</p>
      <Summary report={report} />
      <PhoneSheet name="share-links" title="Share links" summary={`${shares.filter((s) => s.state === "open").length} open${shares.some((s) => s.state === "pending") ? `, ${shares.filter((s) => s.state === "pending").length} to approve` : ""}`}>
        <div className="flex flex-col gap-3">
          <ShareCreator from={report.period.from} to={report.period.to} />
          <Shares shares={shares} fourEyes={approvalSettings.reportFourEyes} />
        </div>
      </PhoneSheet>
      <PhoneSheet name="weekly-digest" title="Weekly digest" summary={digests[0] ? `${digests[0].status === "DRAFT" ? "Draft waiting" : digests[0].status.toLowerCase()}` : "None yet"}>
        <Digests digests={digests} settings={digestSettings} approvals={approvalSettings} canManage={canManage} />
      </PhoneSheet>
    </div>
  );
}
