import { notFound } from "next/navigation";

import { LightWhilePrinting, PrintButton } from "@/components/partners/native/print-statement";
import { requireMarketing } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { creativeIntelEnabled } from "@/lib/creative/flags";
import { copyFingerprint } from "@/lib/creative/fingerprint";
import { AD_FORMATS, charCount, type FieldValues, type FormatKey } from "@/lib/creative/formats";
import type { RuleCheck } from "@/lib/guardrails";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ad copy approval annexure", robots: { index: false, follow: false } };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const stamp = (d: Date) => `${d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;

/**
 * The printable approval annexure for a brief: the APPROVED copy for each channel, its compliance checklist (pass or fail per
 * rule), who approved it and when, a fingerprint of the exact text, and blank lines for the firm's own sign-off. It is a
 * generic record to attach to the firm's ad-approval process; it does not itself approve or publish anything. Only approved
 * variants appear. Opening it is an export and is audited.
 */
export default async function CreativeAnnexurePage({ params }: { params: Promise<{ briefId: string }> }) {
  const session = await requireMarketing("marketing-creative", "view");
  if (!creativeIntelEnabled()) notFound();
  const { briefId } = await params;
  if (!ID.test(briefId)) notFound();
  const brief = await prisma.creativeBrief.findUnique({ where: { id: briefId }, include: { variants: { where: { status: "APPROVED" }, orderBy: { createdAt: "asc" } } } });
  if (!brief) notFound();
  const pending = await prisma.creativeVariant.count({ where: { briefId, status: { not: "APPROVED" } } });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(brief.variants.flatMap((v) => [v.authorId, v.approvedById].filter((x): x is string => Boolean(x))))] } }, select: { id: true, name: true } });
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Unknown";
  await prisma.auditLog.create({ data: { userId: session.user.id, entity: "CreativeBrief", entityId: briefId, action: "creative_annexure_exported" } });
  const now = new Date();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-background p-6 text-foreground print:max-w-none print:p-0">
      <LightWhilePrinting />
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Ad copy approval annexure</p>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">{brief.title}</h1>
          <p className="text-sm text-muted-foreground">Topic: {brief.topic} · Audience: {brief.audience} · {brief.language === "hinglish" ? "Hinglish" : "English"} · Checked against brand profile version {brief.brandVersion ?? 0}</p>
          <p className="text-xs text-muted-foreground">Prepared {stamp(now)} by {name(session.user.id) === "Unknown" ? "the signed-in user" : name(session.user.id)}.</p>
        </div>
        <PrintButton />
      </header>

      {brief.variants.length === 0 && <p role="note" className="rounded-lg border border-border p-3 text-sm">No variant of this brief is approved yet, so there is nothing to attach.</p>}
      {pending > 0 && brief.variants.length > 0 && <p role="note" className="rounded-lg border border-border p-3 text-sm">{pending} other variant{pending === 1 ? " is" : "s are"} not approved and {pending === 1 ? "is" : "are"} left out of this annexure.</p>}

      {brief.variants.map((v, i) => {
        const fields = v.fields as FieldValues;
        const checks = (v.complianceChecks ?? []) as RuleCheck[];
        const spec = AD_FORMATS[v.format as FormatKey];
        const fingerprint = copyFingerprint({ format: v.format, fields, disclaimer: v.disclaimer });
        return (
          <section key={v.id} aria-labelledby={`v-${v.id}`} className="flex break-inside-avoid-page flex-col gap-3 border-t border-border pt-4">
            <h2 id={`v-${v.id}`} className="font-heading text-lg font-semibold">{i + 1}. {spec?.label ?? v.format}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="font-medium">Approved</dd></div>
              <div><dt className="text-xs text-muted-foreground">Approved by</dt><dd className="font-medium">{name(v.approvedById)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Approved on</dt><dd className="font-medium">{v.approvedAt ? stamp(v.approvedAt) : "Not recorded"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Written by</dt><dd className="font-medium">{v.source === "AI" ? "AI draft, reviewed by a person" : name(v.authorId)}</dd></div>
            </dl>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">The approved copy, field by field, with character counts</caption>
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th scope="col" className="py-1.5 pr-3 font-medium">Field</th><th scope="col" className="py-1.5 pr-3 font-medium">Copy</th><th scope="col" className="py-1.5 text-right font-medium">Characters</th></tr></thead>
              <tbody>
                {(spec?.fields ?? []).flatMap((f) => (fields[f.key] ?? []).filter((t) => t.trim()).map((t, k) => (
                  <tr key={`${f.key}-${k}`} className="break-inside-avoid border-b border-border/60 align-top"><th scope="row" className="py-1.5 pr-3 text-left font-medium">{f.label}</th><td className="py-1.5 pr-3 whitespace-pre-wrap">{t}</td><td className="py-1.5 text-right tabular-nums">{charCount(t)}/{f.max}</td></tr>
                )))}
                <tr className="break-inside-avoid border-b border-border/60 align-top"><th scope="row" className="py-1.5 pr-3 text-left font-medium">Disclaimer</th><td className="py-1.5 pr-3 whitespace-pre-wrap" colSpan={2}>{v.disclaimer || "None"}</td></tr>
              </tbody>
            </table>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Compliance checklist (at approval)</h3>
              <table className="w-full border-collapse text-xs">
                <caption className="sr-only">Each rule, and whether the copy passed it</caption>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.id} className="break-inside-avoid border-b border-border/60"><th scope="row" className="w-2/3 py-1 pr-3 text-left font-normal">{c.label}</th><td className="py-1 font-medium">{c.status === "pass" ? "Pass" : c.status === "fail" ? "Fail" : "Not applicable"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Text fingerprint (SHA-256, first 16 characters): <code>{fingerprint}</code>. Any change to the copy changes it and withdraws the approval.</p>
          </section>
        );
      })}

      {brief.variants.length > 0 && (
        <section aria-label="Sign-off" className="break-inside-avoid border-t border-border pt-4">
          <h2 className="mb-3 font-heading text-lg font-semibold">Sign-off</h2>
          <div className="grid gap-6 text-sm sm:grid-cols-2">
            {["Reviewed by (compliance)", "Approved for use by"].map((label) => (
              <div key={label} className="flex flex-col gap-5"><p className="font-medium">{label}</p><p className="border-b border-foreground/50 pb-1 text-xs text-muted-foreground">Name</p><p className="border-b border-foreground/50 pb-1 text-xs text-muted-foreground">Signature</p><p className="border-b border-foreground/50 pb-1 text-xs text-muted-foreground">Date</p></div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">This annexure is a record of the copy and its checks. It does not approve, schedule or publish an advertisement; the firm&apos;s own ad-approval process does.</p>
        </section>
      )}
    </main>
  );
}
