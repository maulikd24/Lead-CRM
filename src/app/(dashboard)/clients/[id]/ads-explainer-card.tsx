import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PhoneSheet } from "@/components/workspace";
import { explainerSummary, type Explainer } from "@/lib/closedloop/explainer";

/** "Why wasn't this customer sent to the ad platforms?" Reasons only, by design: no spend, campaign or revenue figure, and no identifier, because every role that sees the consent tab sees this. */
export function AdsExplainerCard({ explainer }: { explainer: Explainer }) {
  return (
    <PhoneSheet name="ads-explainer" title="Ad measurement" summary={explainerSummary(explainer)}>
    <Card aria-labelledby="ads-explainer-heading">
      <CardHeader>
        <CardTitle id="ads-explainer-heading" className="text-base">Ad measurement: was this customer sent?</CardTitle>
        <p className="text-sm text-muted-foreground">Only customers who agreed to ad measurement are ever sent, and only as coded identifiers. This says where this customer stands.</p>
      </CardHeader>
      <CardContent>
        {explainer.kind === "no_destination" && <p className="text-sm">No ad destination is set up and switched on, so nothing is sent for anyone.</p>}
        {explainer.kind === "no_event" && <p className="text-sm">This customer has no completed KYC or first funding yet, so there is nothing to send.</p>}
        {explainer.kind === "lines" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Events: {explainer.events.join(", ")}</p>
            <ul className="flex flex-col gap-2">
              {explainer.lines.map((l) => (
                <li key={l.destination} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <span className="font-medium">{l.destination}</span>
                  <Badge variant={l.sendable ? "success" : "warning"}>{l.sendable ? "Can be sent" : "Not sent"}</Badge>
                  <span className="text-muted-foreground">{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
    </PhoneSheet>
  );
}
