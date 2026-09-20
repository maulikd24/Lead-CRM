import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { RmPillars } from "@/lib/reports/rm-pillars";

function formatInr(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function RmPillarsCard({ pillars, fromValue, toValue }: { pillars: RmPillars; fromValue: string; toValue: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Performance Pillars</CardTitle>
          <p className="text-sm text-muted-foreground">Activity and Business are scoped to the date range below; Journey is point-in-time.</p>
        </div>
        <form className="flex flex-wrap items-end gap-2">
          <Input name="pillarsFrom" type="date" defaultValue={fromValue} className="w-36" />
          <Input name="pillarsTo" type="date" defaultValue={toValue} className="w-36" />
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Activity</p>
            <Metric label="Clients contacted" value={pillars.activity.clientsContacted} />
            <Metric label="Meetings completed" value={pillars.activity.meetingsCompleted} />
            <Metric label="Follow-up completion" value={`${pillars.activity.followUpCompletionRate}%`} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Journey</p>
            <Metric label="KYC completion" value={`${pillars.journey.kycCompletionRate}%`} />
            <Metric label="Wealth Health Checkup" value={`${pillars.journey.wealthHealthCheckupCompletionRate}%`} />
            <Metric label="Smart Allvest" value={`${pillars.journey.smartAllvestCompletionRate}%`} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Business</p>
            <Metric label="Funds received" value={formatInr(pillars.business.fundsReceived)} />
            <Metric label="Investments executed" value={pillars.business.investmentsExecuted} />
            <Metric label="Net AUM added" value={formatInr(pillars.business.netAumAdded)} />
            <Metric label="Product penetration" value={`${pillars.business.productPenetrationRate}%`} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Relationship Quality</p>
            <p className="text-sm text-muted-foreground">
              Client Engagement Score, NPS, and Service Issue Closure Time will appear here once engagement/NPS tracking ships.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
