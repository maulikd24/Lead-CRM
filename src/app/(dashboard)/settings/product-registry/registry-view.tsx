import { AlertTriangle, CheckCircle2, CircleDashed, PauseCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EXAMPLE_LABEL, labelOf, type ProductStatus, type VersionState } from "@/lib/registry/model";
import type { getProduct, ProductListRow } from "@/lib/registry/service";
import { ReviewButtons, ReviseButton, StatusButtons, SubmitButton } from "./controls";
import { EditDraftButton } from "./sheets";

type Detail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

const STATUS: Record<ProductStatus, { icon: typeof CheckCircle2; word: string; cls: string }> = {
  APPROVED: { icon: CheckCircle2, word: "Approved", cls: "text-success" },
  DRAFT: { icon: CircleDashed, word: "Draft", cls: "text-muted-foreground" },
  SUSPENDED: { icon: PauseCircle, word: "Suspended", cls: "text-warning" },
  RETIRED: { icon: XCircle, word: "Retired", cls: "text-muted-foreground" },
};
const VERSION_WORD: Record<VersionState, string> = { DRAFT: "Draft", IN_REVIEW: "In review", APPROVED: "Approved", REJECTED: "Rejected", SUPERSEDED: "Superseded" };
const label = labelOf;
const date = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "none");
export const rupees = (minor: number | null, currency: string) => (minor === null ? "No minimum" : `${currency} ${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

/** State is always an icon AND a word, never colour alone. */
export function StatusChip({ status }: { status: ProductStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", s.cls)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {s.word}
    </span>
  );
}

export function listItem(r: ProductListRow): { id: string; title: ReactNode; meta: ReactNode; trailing: ReactNode } {
  return {
    id: r.head.id,
    title: r.name,
    meta: `${label(r.category || "none")} · ${r.activeVersionNo ? `v${r.activeVersionNo}` : "no approved version"}${r.openVersion ? ` · ${VERSION_WORD[r.openVersion.state].toLowerCase()} v${r.openVersion.versionNo}` : ""}`,
    trailing: (
      <span className="flex items-center gap-1">
        {r.head.isExample && <Badge variant="outline">Example</Badge>}
        <StatusChip status={r.head.status} />
      </span>
    ),
  };
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    {children}
  </section>
);
const List = ({ items, empty }: { items: ReactNode[]; empty: string }) =>
  items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

/** One product: what is in force, the versions, and the actions that are legal right now. Rendered once per selection. */
export function ProductDetail({ p, viewerId, names }: { p: Detail; viewerId: string; names: Record<string, string> }) {
  const active = p.versions.find((v) => v.id === p.head.activeVersionId) ?? null;
  const open = p.versions.find((v) => v.state === "DRAFT" || v.state === "IN_REVIEW") ?? null;
  const shown = active ?? p.versions[0];
  const who = (id: string | null) => (id ? (id === "seed" ? "Seed" : names[id] ?? "Unknown") : "n/a");
  const retired = p.head.status === "RETIRED";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-lg font-semibold leading-tight">{shown?.name}</h2>
          <StatusChip status={p.head.status} />
          {p.head.isExample && <Badge variant="outline">Example</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">Key <code>{p.head.key}</code> · registry id <code>{p.head.id}</code> (the id agents and campaigns cite)</p>
        {p.head.status === "SUSPENDED" && <p className="flex items-start gap-1.5 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Suspended: cannot be cited anywhere. {p.head.statusReason}. Approving a new version reinstates it.</p>}
        {retired && <p className="text-sm text-muted-foreground">Retired for good. {p.head.statusReason}</p>}
        {p.head.isExample && <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">{EXAMPLE_LABEL}</p>}
      </div>

      {shown && (
        <>
          <Block title={active ? `In force: version ${active.versionNo}` : "Latest version (nothing approved yet)"}>
            <Facts
              rows={[
                ["Category", label(shown.category)],
                ["Risk category", label(shown.riskCategory)],
                ["Availability", label(shown.availability)],
                ["Minimum investment", rupees(shown.minInvestmentMinor, shown.currency)],
                ["Jurisdictions", shown.jurisdictions.join(", ")],
                ["Valid", shown.validFrom || shown.validTo ? `${shown.validFrom ? `from ${date(shown.validFrom)}` : "no start date"}, ${shown.validTo ? `to ${date(shown.validTo)}` : "no end date"}` : "No date limit"],
              ]}
            />
            {shown.summary && <p className="text-sm">{shown.summary}</p>}
          </Block>
          <Block title="Required documents"><List items={shown.requiredDocuments} empty="None listed." /></Block>
          <Block title="Investor eligibility"><List items={shown.eligibility.map((e) => <span key={e.code}><span className="text-muted-foreground">{label(e.kind)}:</span> {e.value}</span>)} empty="No rules listed." /></Block>
          <Block title="Sales restrictions"><List items={shown.salesRestrictions.map((r) => <span key={r.code}>{r.text}</span>)} empty="None." /></Block>
          <Block title="Approved marketing claims">
            <List items={shown.claims.map((c) => <span key={c.id}>{c.text} <code className="text-xs text-muted-foreground">{c.id}</code>{c.validUntil ? <span className="text-xs text-muted-foreground"> · until {date(new Date(c.validUntil))}</span> : null}</span>)} empty="No claims approved. Marketing has nothing to use." />
          </Block>
        </>
      )}

      {!retired && (
        <Block title="What you can do">
          <div className="flex flex-col gap-3">
            {open?.state === "DRAFT" && (
              <div className="flex flex-wrap items-center gap-2">
                <EditDraftButton />
                <SubmitButton versionId={open.id} />
                <span className="text-xs text-muted-foreground">Draft v{open.versionNo}: nothing changes live until it is approved.</span>
              </div>
            )}
            {open?.state === "IN_REVIEW" && (open.createdById === viewerId ? (
              <p className="text-sm text-muted-foreground">Version {open.versionNo} is waiting for a second Admin to review it. You authored it, so you cannot approve it.</p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-sm">Version {open.versionNo} was written by {who(open.createdById)} and is waiting for your review.</p>
                <ReviewButtons versionId={open.id} />
              </div>
            ))}
            {!open && <div><ReviseButton productId={p.head.id} /></div>}
            <StatusButtons productId={p.head.id} status={p.head.status} />
          </div>
        </Block>
      )}

      <Block title="Versions">
        <div className="overflow-x-auto" role="region" aria-label="Versions of this product" tabIndex={0}>
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="sr-only">Versions of this product</caption>
            <thead className="text-xs text-muted-foreground">
              <tr><th scope="col" className="py-1 pr-3 font-medium">Version</th><th scope="col" className="py-1 pr-3 font-medium">State</th><th scope="col" className="py-1 pr-3 font-medium">Written by</th><th scope="col" className="py-1 pr-3 font-medium">Reviewed by</th><th scope="col" className="py-1 font-medium">Note</th></tr>
            </thead>
            <tbody>
              {p.versions.map((v) => (
                <tr key={v.id} className="border-t border-border align-top">
                  <td className="py-1 pr-3 tabular-nums">v{v.versionNo}</td>
                  <td className="py-1 pr-3">{VERSION_WORD[v.state]}</td>
                  <td className="py-1 pr-3">{who(v.createdById)}</td>
                  <td className="py-1 pr-3">{v.reviewedBy ? `${who(v.reviewedBy)}${v.reviewedAt ? `, ${date(v.reviewedAt)}` : ""}` : "n/a"}</td>
                  <td className="py-1">{v.reviewNote ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </div>
  );
}
