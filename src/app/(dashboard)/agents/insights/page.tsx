import "./insights.css";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth/require-role";
import { insightsEnabled } from "@/lib/insights/range";
import { loadInsights } from "@/lib/insights/queries";
import { PageHeader } from "@/components/shared/page-header";
import { OutcomeMixPanel, ReplyDelayChart } from "./charts";
import { RangeControl } from "./range-control";
import { AbPanel, AgentQualityPanel, ConversionTable, Drilldown, JourneyFunnel, KpiTiles, ObjectionHeat, ResponseTables, Section, SuggestionsPanel } from "./sections";

export const dynamic = "force-dynamic";

export default async function AgentInsightsPage({ searchParams }: { searchParams: Promise<{ days?: string | string[] }> }) {
  if (!insightsEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const { days } = await searchParams;
  const data = await loadInsights({ id: session.user.id, role: session.user.role }, days);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agent insights"
        description="What customers respond to, how the agents are doing, and what to change. Aggregates only: no customer names appear in the charts."
        actions={
          <>
            <Link href="/agents" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Agent drafts
            </Link>
            <RangeControl days={data.days} />
          </>
        }
      />

      {data.truncated && <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">This period has more rows than the page reads at once, so these figures are partial: they cover only the most recent rows, and counts, rates and the cost estimate are lower bounds. Choose a shorter range for exact numbers.</p>}

      <KpiTiles kpis={data.kpis} />
      <SuggestionsPanel suggestions={data.suggestions} />

      <Section title="What customers respond to" description="Outcome mix recorded by RMs and agents. Bars show each group as 100%, so groups of different sizes compare fairly." at={150}>
        <OutcomeMixPanel mix={data.mix} />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="When customers reply" description="Time to the first WhatsApp reply after a message, within 72 hours." at={200}>
          <div className="flex flex-col gap-6">
            <ReplyDelayChart buckets={data.response.buckets} />
            <ResponseTables response={data.response} />
          </div>
        </Section>
        <Section title="What happens next" description="Whether customers reached KYC approval or funding within 14 days of an outcome or an agent draft. Only events at least 14 days old count, so this looks back past the selected range." at={250}>
          <ConversionTable conversion={data.conversion} />
        </Section>
      </div>

      <Section title="Objections by asset class" description="Concerns customers raised, grouped into themes. Darker cells mean more concerns. Arrows compare the biggest theme with the previous period." at={300}>
        <ObjectionHeat objections={data.objections} />
      </Section>

      <Section title="Where customers drop in the journey" description="Customers who joined in this period: how many reached each stage, how many moved on, and how long they stayed." at={350}>
        <JourneyFunnel funnel={data.funnel} />
      </Section>

      <Section title="Agent quality and safety" description="Per agent: what was drafted, what the guardrails stopped, and what people did with the rest." at={400}>
        <AgentQualityPanel agents={data.agents} />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="AI drafts compared with RM-only messages" description="Reply rates, with a sample-size check so early noise is not mistaken for a result." at={450}>
          <AbPanel aiVsRm={data.aiVsRm} />
        </Section>
        <Section title="Recent declines and handovers" description="First name and client code only. You see the customers you already have access to." at={500}>
          <Drilldown rows={data.drilldown} />
        </Section>
      </div>
    </div>
  );
}
