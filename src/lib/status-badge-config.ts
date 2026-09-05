import type { badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export const CLIENT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  ON_HOLD: "warning",
  COMPLETED: "success",
  NOT_PROCEEDING: "destructive",
};

export const PRIORITY_VARIANT: Record<string, BadgeVariant> = {
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "outline",
};

export const SLA_VARIANT: Record<string, BadgeVariant> = {
  ON_TRACK: "success",
  DUE_SOON: "warning",
  OVERDUE: "destructive",
  NOT_APPLICABLE: "outline",
};
