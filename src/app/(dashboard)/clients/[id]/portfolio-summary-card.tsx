"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PortfolioSummary } from "@/lib/clients/portfolio-aggregate";
import { PortfolioSummaryView } from "./portfolio-summary-view";
import { getPortfolioSummaryAction } from "./portfolio-actions";

/**
 * Name, total AUM, asset-class mix and the last trading date: nothing else. It loads once when it first shows (one aggregate read) and
 * is not refetched when the page refreshes after an unrelated change.
 */
export function PortfolioSummaryCard({ clientId }: { clientId: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; data: PortfolioSummary }>({ status: "loading" });

  useEffect(() => {
    let live = true;
    getPortfolioSummaryAction(clientId)
      .then((data) => live && setState({ status: "ready", data }))
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, [clientId]);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2" aria-busy={state.status === "loading"}>
        {state.status === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state.status === "error" && <p className="text-sm text-muted-foreground">Could not load the portfolio.</p>}
        {state.status === "ready" && <PortfolioSummaryView data={state.data} />}
      </CardContent>
    </Card>
  );
}
