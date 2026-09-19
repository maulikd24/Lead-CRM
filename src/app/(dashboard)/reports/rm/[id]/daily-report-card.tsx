"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format";
import type { RmDailyReport } from "@/lib/reports/rm-daily-report";

const OPPORTUNITY_PLACEHOLDER = "Available once Opportunity Management ships";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function DailyReportCard({ report, rmId }: { report: RmDailyReport; rmId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleDateChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("reportDate", value);
    else params.delete("reportDate");
    router.push(`${pathname}?${params.toString()}`);
  }

  const pdfHref = `/api/reports/rm-daily-report?rmId=${encodeURIComponent(rmId)}&date=${toDateInputValue(report.date)}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>RM Daily Report — {formatDate(report.date)}</CardTitle>
          <p className="text-sm text-muted-foreground">RM: {report.rmName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="w-40"
            defaultValue={toDateInputValue(report.date)}
            onChange={(e) => handleDateChange(e.target.value)}
          />
          <Button variant="outline" size="sm" render={<Link href={pdfHref} />}>
            Download PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <section>
          <h4 className="font-medium mb-1.5">Client Activity</h4>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            <li>Clients contacted: <span className="text-foreground font-medium">{report.clientActivity.clientsContacted}</span></li>
            <li>Meetings completed: <span className="text-foreground font-medium">{report.clientActivity.meetingsCompleted}</span></li>
            <li>Follow-ups completed: <span className="text-foreground font-medium">{report.clientActivity.followUpsCompleted}</span></li>
            <li>Overdue follow-ups: <span className="text-foreground font-medium">{report.clientActivity.overdueFollowUps}</span></li>
          </ul>
        </section>

        <section>
          <h4 className="font-medium mb-1.5">Client Progress</h4>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            <li>KYC completed: <span className="text-foreground font-medium">{report.clientProgress.kycCompleted}</span></li>
            <li>Wealth Health Checkup completed: <span className="italic">{OPPORTUNITY_PLACEHOLDER}</span></li>
            <li>Smart Allvest completed: <span className="italic">{OPPORTUNITY_PLACEHOLDER}</span></li>
            <li>Recommendations discussed: <span className="italic">{OPPORTUNITY_PLACEHOLDER}</span></li>
            <li>Clients funded: <span className="text-foreground font-medium">{report.clientProgress.clientsFunded}</span></li>
            <li>Investments completed: <span className="text-foreground font-medium">{report.clientProgress.investmentsCompleted}</span></li>
          </ul>
        </section>

        <section>
          <h4 className="font-medium mb-1.5">Business</h4>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            <li>New potential identified: <span className="italic">{OPPORTUNITY_PLACEHOLDER}</span></li>
            <li>Funds committed: <span className="italic">{OPPORTUNITY_PLACEHOLDER}</span></li>
            <li>Funds received: <span className="text-foreground font-medium">₹{report.business.fundsReceived.toLocaleString("en-IN")}</span></li>
            <li>Investment completed: <span className="text-foreground font-medium">₹{report.business.investmentCompleted.toLocaleString("en-IN")}</span></li>
          </ul>
        </section>

        <section>
          <h4 className="font-medium mb-1.5">Priority Clients</h4>
          {report.priorityClients.length === 0 ? (
            <p className="text-muted-foreground">No high-priority active clients right now.</p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {report.priorityClients.map((c) => (
                <li key={c.id}>
                  {c.name} ({c.clientCode}) — <span className="italic">{OPPORTUNITY_PLACEHOLDER}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="font-medium mb-1.5">Blockers</h4>
          {report.blockers.length === 0 ? (
            <p className="text-muted-foreground">No open blockers.</p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {report.blockers.map((b, i) => (
                <li key={`${b.clientId}-${i}`}>
                  {b.clientName} — {b.reason}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="font-medium mb-1.5">Tomorrow&apos;s Priorities</h4>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            <li>{report.tomorrowsPriorities.followUps} scheduled follow-ups</li>
            <li>{report.tomorrowsPriorities.meetings} portfolio meetings</li>
            <li>{report.tomorrowsPriorities.funding} funding follow-up / key tasks</li>
            {report.tomorrowsPriorities.other > 0 && <li>{report.tomorrowsPriorities.other} other tasks</li>}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
