import type { Role } from "../../src/generated/prisma/client";

/** The six roles the suite signs in as. Users come from prisma/seed-e2e.ts; the password is the documented seed password. */
export const ROLES = {
  admin: { email: "admin@supportify.local", role: "ADMIN" },
  manager: { email: "manager@supportify.local", role: "MANAGER" },
  rm: { email: "rm@supportify.local", role: "RM" },
  marketing: { email: "marketing@supportify.local", role: "MARKETING" },
  finance: { email: "finance@supportify.local", role: "FINANCE" },
  partner: { email: "partner1@supportify.local", role: "PARTNER" },
} as const satisfies Record<string, { email: string; role: Role }>;

export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/** Only the seed password for local and CI scratch databases; never a real credential. */
export const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
