import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { formatCode } from "@/lib/referrals/code";
import { formatRupees } from "@/lib/referrals/summary";
import type { ReferrerRow } from "@/lib/referrals/views";

import { EnrollForm, InviteDraft, ReferrerButtons, RevokeCode } from "./controls";

export function ReferrersTab({ rows, canManage }: { rows: ReferrerRow[]; canManage: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <Card size="sm" className={motion.enter}>
          <CardHeader>
            <CardTitle className="font-heading text-sm">Add a referrer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <EnrollForm />
            <p className="text-xs text-muted-foreground">A referrer is an existing customer. They get a code that is hard to guess and can be revoked at any time. Customers who sign up in the app with it are credited to them.</p>
          </CardContent>
        </Card>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No referrers yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.id}>
              <Card size="sm" className={motion.enter} style={{ ["--i" as string]: Math.min(i, 8) }}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {r.name} <span className="font-normal text-muted-foreground">{r.clientCode}</span>
                    </span>
                    <Badge variant={r.status === "ACTIVE" ? "success" : "warning"}>{r.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    {([["Referred", r.referrals], ["KYC complete", r.kyc], ["Funded", r.funded]] as const).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-muted-foreground">{k}</dt>
                        <dd className="font-heading font-semibold tabular-nums">{v}</dd>
                      </div>
                    ))}
                    <div>
                      <dt className="text-xs text-muted-foreground">Rewards accrued</dt>
                      <dd className="font-heading font-semibold tabular-nums">{formatRupees(r.earnedPaise)}</dd>
                    </div>
                  </dl>
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
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
