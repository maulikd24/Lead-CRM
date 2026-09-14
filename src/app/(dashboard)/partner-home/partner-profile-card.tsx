import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PartnerProfile } from "@/generated/prisma/client";

export function PartnerProfileCard({ profile }: { profile: PartnerProfile }) {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-base">{profile.partnerCode}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Badge variant="outline">{profile.partnerType}</Badge>
        <Badge variant="outline">{profile.tier}</Badge>
        <Badge variant="outline">{profile.empanelmentStatus.replace(/_/g, " ")}</Badge>
        {profile.region && <Badge variant="outline">{profile.region}</Badge>}
      </CardContent>
    </Card>
  );
}
