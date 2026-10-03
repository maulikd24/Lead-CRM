import type { AssignmentMode } from "@/generated/prisma/client";

// Pure (no database import) so client components can use it.
export const ASSIGNMENT_MODE_LABELS: Record<AssignmentMode, { label: string; description: string }> = {
  LOAD_BASED: {
    label: "Load-based",
    description:
      "Each new lead goes to the eligible RM with the fewest active clients. Keeps workloads even automatically. This is the original behaviour.",
  },
  ROUND_ROBIN: {
    label: "Round robin",
    description:
      "New leads rotate through the eligible RMs in a fixed order, one each, regardless of how many clients they already have (capacity limits still apply).",
  },
  MANUAL: {
    label: "Manual",
    description:
      "Nothing is assigned automatically. New leads wait in the Unassigned queue and every Admin and Manager is alerted to assign them. Choosing an RM when creating a lead still works.",
  },
};
