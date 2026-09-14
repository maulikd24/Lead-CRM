import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/format";
import type { HierarchyAssignment, PartnerProfile } from "@/generated/prisma/client";

type AssignmentWithRefs = HierarchyAssignment & {
  parentUser: { name: string } | null;
  parentPartner: { partnerCode: string } | null;
  team: { name: string } | null;
};

export function PartnerHierarchyPanel({
  profile,
  assignments,
}: {
  profile: PartnerProfile | null;
  assignments: AssignmentWithRefs[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {profile && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Partner Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Partner Code</p>
              <p className="font-mono">{profile.partnerCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Type</p>
              <Badge variant="outline">{profile.partnerType}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tier</p>
              <Badge variant="outline">{profile.tier}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Empanelment Status</p>
              <Badge variant="outline">{profile.empanelmentStatus.replace(/_/g, " ")}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Region</p>
              <p>{profile.region ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ARN Code</p>
              <p>{profile.arnCode ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Hierarchy History</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hierarchy assignments yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {assignments.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 border-l-2 border-muted pl-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{a.relationType.replace(/_/g, " ")}</Badge>
                    {!a.validTo && <Badge variant="success">Current</Badge>}
                  </div>
                  <p className="text-muted-foreground">
                    {a.parentUser
                      ? `Under ${a.parentUser.name}`
                      : a.parentPartner
                        ? `Under ${a.parentPartner.partnerCode}`
                        : a.team
                          ? `Team: ${a.team.name}`
                          : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(a.validFrom)} – {a.validTo ? formatDate(a.validTo) : "Present"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
