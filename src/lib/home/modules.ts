import type { Role } from "@/generated/prisma/client";

export type HomeModule = "needsYouNow" | "todayQueue" | "schedule" | "teamPulse" | "managerAttention";

export function homeModulesFor(role: Role): HomeModule[] {
  switch (role) {
    case "RM":
      return ["needsYouNow", "todayQueue", "schedule"];
    case "MANAGER":
    case "ADMIN":
      return ["todayQueue", "teamPulse", "managerAttention"];
    default:
      return ["todayQueue"];
  }
}

// Column spans (of 12, at lg+) per module; each role's modules sum to 12 so they sit in one row.
const SPANS: Record<"rm" | "team" | "other", Partial<Record<HomeModule, number>>> = {
  rm: { needsYouNow: 3, todayQueue: 6, schedule: 3 },
  team: { todayQueue: 4, teamPulse: 4, managerAttention: 4 },
  other: { todayQueue: 12 },
};

export function homeSpansFor(role: Role): Record<HomeModule, number> {
  const key = role === "RM" ? "rm" : role === "MANAGER" || role === "ADMIN" ? "team" : "other";
  return { needsYouNow: 0, todayQueue: 0, schedule: 0, teamPulse: 0, managerAttention: 0, ...SPANS[key] };
}
