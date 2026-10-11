import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { bandsToText, REAL_FIELDS } from "@/lib/closedloop/config";
import { loadDestinationsView } from "@/lib/closedloop/views-db";

import { BandsForm } from "./bands-form";
import { DestinationForm } from "./destination-form";

/** Configuration is for Admins; Marketing sees the state (what is on, which region is approved) but not the credential boxes. Secrets are never sent to the browser: the form only learns which boxes are filled. */
export async function DestinationsTab({ isAdmin }: { isAdmin: boolean }) {
  const { destinations, global } = await loadDestinationsView();
  return (
    <div className="flex flex-col gap-4">
      {destinations.map((d) => (
        <Card key={d.key}>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">{d.label}</CardTitle>
            <div className="flex gap-2">
              <Badge variant={d.setUp ? "success" : "outline"}>{d.setUp ? "Credentials saved" : "Not set up"}</Badge>
              <Badge variant={d.enabled ? "success" : "outline"}>{d.enabled ? "Switched on" : "Off"}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {isAdmin ? (
              <DestinationForm
                destinationKey={d.key}
                initial={{ enabled: d.enabled, region: d.region ?? "", allowedRegions: d.allowedRegions.join(", "), sendValue: d.sendValue }}
                fields={d.key === "fake" ? [] : REAL_FIELDS[d.key].map((f) => ({ ...f, filled: d.filled[f.key] === true }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Data region: {d.region ?? "not set"}. Approved regions: {d.allowedRegions.length ? d.allowedRegions.join(", ") : "none yet, so nothing is sent"}. An Admin changes these.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assets bands (optional)</CardTitle>
          <p className="text-sm text-muted-foreground">Report when a customer&apos;s assets pass a band, for example 10L=1000000. Leave blank to report KYC and first funding only.</p>
        </CardHeader>
        <CardContent>{isAdmin ? <BandsForm initial={bandsToText(global.aumBands)} /> : <p className="text-sm text-muted-foreground">{global.aumBands ? bandsToText(global.aumBands) : "Off."}</p>}</CardContent>
      </Card>
    </div>
  );
}
