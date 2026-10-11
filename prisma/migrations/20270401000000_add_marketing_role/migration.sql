-- AlterEnum: additive Role value. Kept alone in its own migration because a new enum value cannot be used in the
-- transaction that adds it (same pattern as 20260827000000_add_dealer_role).
ALTER TYPE "Role" ADD VALUE 'MARKETING';
