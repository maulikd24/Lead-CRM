import type { User } from "@/generated/prisma/client";

/** A User as every query returns it: the Prisma client omits passwordHash by default (see ./prisma.ts).
 * Use this, not `User`, for anything that can reach a client component. */
export type SafeUser = Omit<User, "passwordHash">;
