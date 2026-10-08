-- Forced password change + session invalidation (User.mustChangePassword / User.sessionsValidFrom).
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);

-- Security response: until the 8 October 2026 deploy, every active user's bcrypt password hash was sent to the
-- browser on client, task and user pages, readable by any signed-in user. Sign out every active Admin, Manager and
-- Team Manager now and require a new password (not the old one) at their next sign-in.
UPDATE "User"
SET "mustChangePassword" = true, "sessionsValidFrom" = CURRENT_TIMESTAMP
WHERE "isActive" = true AND "role" IN ('ADMIN', 'MANAGER', 'TEAM_MANAGER');
