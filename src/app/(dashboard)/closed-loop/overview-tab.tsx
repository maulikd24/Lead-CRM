import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip, KpiTile } from "@/components/workspace";
import { closedLoopEnabled, killSwitchOn } from "@/lib/closedloop/config";
import { loadOverview } from "@/lib/closedloop/views-db";
import { loadDestinationsView } from "@/lib/closedloop/views-db";
import { coverageShare } from "@/lib/closedloop/summary";
import { EVENT_LABEL, type EventType } from "@/lib/closedloop/events";

import { KillSwitch } from "./kill-switch";

const when = (d: Date | null) => (d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "Never");

export async function OverviewTab({ isAdmin }: { isAdmin?: boolean }) {
  const [o, { destinations, global }] = await Promise.all([loadOverview(), loadDestinationsView()]);
  const stopped = killSwitchOn(process.env, global);
  const live = destinations.filter((d) => d.setUp && d.enabled).length;
  const share = coverageShare({ funded: o.funded.funded, sendable: o.funded.consented });
  return (
    <div className="flex flex-col gap-4">
      <KpiStrip label="Closed loop figures">
        <KpiTile label="Sent" index={0} hint={`last ${when(o.lastSentAt)}`}>{o.statuses.sent}</KpiTile>
        <KpiTile label="Waiting" index={1} hint="queued or retrying">{o.statuses.waiting}</KpiTile>
        <KpiTile label="Failed" index={2} tone={o.statuses.failed ? "destructive" : "default"} hint="see Events">{o.statuses.failed}</KpiTile>
        <KpiTile label="Not sent" index={3} hint="no consent, no identifiers, too old">{o.statuses.skipped}</KpiTile>
        <KpiTile label="Funded customers who agreed" index={4} hint={share ? `${Math.round(share.share * 100)}% of ${o.funded.funded}${share.small ? " (small sample)" : ""}` : "no funded customers yet"}>{o.funded.consented}</KpiTile>
      </KpiStrip>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={stopped ? "destructive" : "success"}>{stopped ? "Stopped" : "Running"}</Badge>
            <span className="text-muted-foreground">{stopped ? "The kill switch is on. Nothing is sent while it is." : `${live} destination${live === 1 ? "" : "s"} switched on. The job runs every few minutes.`}</span>
          </div>
          <KillSwitch on={global.killSwitch} envOn={process.env.CLOSED_LOOP_KILL_SWITCH === "1"} canTurnOff={Boolean(isAdmin)} />
          <p className="text-muted-foreground">
            {o.match ? `Platforms matched ${Math.round(o.match.rate * 100)}% of ${o.match.reported} events they reported on.` : "Match rate: the platforms have not reported one, so none is shown. Check Meta Events Manager or Google Ads for it."}
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {(Object.keys(EVENT_LABEL) as EventType[]).map((t) => (
              <li key={t}>{EVENT_LABEL[t]}: <span className="tabular-nums font-medium">{o.sentByEvent[t] ?? 0}</span> sent</li>
            ))}
          </ul>
          {!closedLoopEnabled() && <p>Module is off.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
