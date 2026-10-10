import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, StickyActionBar, type MasterItem } from "@/components/workspace";
import { formatCode } from "@/lib/referrals/code";
import { formatRupees } from "@/lib/referrals/summary";
import type { ReferrerRow } from "@/lib/referrals/views";

import { EnrollForm, InviteDraft, ReferrerButtons, RevokeCode } from "./controls";
import { Trailing } from "./trailing";

function Enroll() {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-heading text-base font-semibold">Add a referrer</p>
      <EnrollForm />
      <p className="text-xs text-muted-foreground">A referrer is an existing customer. They get a code that is hard to guess and can be revoked at any time. Customers who sign up in the app with it are credited to them.</p>
    </div>
  );
}

function Detail({ r, canManage }: { r: ReferrerRow; canManage: boolean }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-semibold">{r.name}</p>
          <p className="text-muted-foreground">{r.clientCode}</p>
        </div>
        <Badge variant={r.status === "ACTIVE" ? "success" : "warning"}>{r.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {([["Referred", String(r.referrals)], ["KYC complete", String(r.kyc)], ["Funded", String(r.funded)], ["Rewards accrued", formatRupees(r.earnedPaise)]] as const).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-heading font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {r.toReview > 0 && <p role="status"><Badge variant="warning">{r.toReview} to review</Badge> <span className="text-muted-foreground">in the Rewards ledger.</span></p>}
      <ul className="flex flex-col gap-1.5" aria-label={`Codes for ${r.name}`}>
        {r.codes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm tracking-wider">{formatCode(c.code)}</code>
            <Badge variant={c.status === "ACTIVE" ? "success" : "outline"}>{c.status === "ACTIVE" ? "Live" : "Revoked"}</Badge>
            {c.status === "REVOKED" && c.revokeReason && <span className="text-xs text-muted-foreground">{c.revokeReason}</span>}
            {canManage && c.status === "ACTIVE" && <RevokeCode codeId={c.id} />}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-wrap items-start gap-2">
          <ReferrerButtons id={r.id} status={r.status} />
          {r.status === "ACTIVE" && <InviteDraft referrerId={r.id} />}
        </div>
      )}
    </div>
  );
}

export function ReferrersTab({ rows, canManage }: { rows: ReferrerRow[]; canManage: boolean }) {
  const items: MasterItem[] = [
    ...(canManage ? [{ id: "new", title: "Add a referrer", meta: "Make an existing customer a referrer" }] : []),
    ...rows.map((r) => ({
      id: r.id,
      title: r.name,
      meta: `${r.clientCode} · ${r.referrals} referred · ${r.funded} funded`,
      trailing: <Trailing chips={[{ label: r.status === "ACTIVE" ? "Active" : "Suspended", variant: r.status === "ACTIVE" ? "success" : "warning" }, ...(r.toReview > 0 ? [{ label: `${r.toReview} to review`, variant: "warning" as const }] : [])]} />,
    })),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No referrers yet.</p>
      ) : (
        <MasterDetail
          idPrefix="rf"
          label="Referrers"
          noun="referrers"
          items={items}
          details={{ new: <Enroll />, ...Object.fromEntries(rows.map((r) => [r.id, <Detail key={r.id} r={r} canManage={canManage} />])) }}
        />
      )}
      {canManage && (
        <StickyActionBar phoneOnly label="Referrer actions">
          <Button size="lg" render={<Link href="?tab=referrers&item=new&sheet=rf-detail" scroll={false} />}>
            Add referrer
          </Button>
        </StickyActionBar>
      )}
    </div>
  );
}
