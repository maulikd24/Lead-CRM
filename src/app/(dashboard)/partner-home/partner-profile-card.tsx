import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PartnerProfile } from "@/generated/prisma/client";
import { CopyCodeButton } from "@/components/partners/copy-code-button";

/** The partner's identity and how to refer people: their code always, and their link once Finance has set the form address in Settings. */
export function PartnerProfileCard({ profile, referralLink = null }: { profile: PartnerProfile; referralLink?: string | null }) {
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
        <div className="flex w-full flex-col gap-1.5 pt-1 text-sm">
          <p className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">Your referral code</span><CopyCodeButton code={profile.partnerCode} /></p>
          {referralLink && <p className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">Your referral link</span><CopyCodeButton code={referralLink} what="referral link" /></p>}
          <p className="text-xs text-muted-foreground">Someone who arrives through your link or code is credited to you from their first contact.</p>
        </div>
      </CardContent>
    </Card>
  );
}
