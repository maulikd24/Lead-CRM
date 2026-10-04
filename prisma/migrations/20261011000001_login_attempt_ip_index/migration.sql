-- Per-IP failed-login throttling (src/lib/auth/config.ts) counts recent failures by ipAddress.
CREATE INDEX "LoginAttempt_ipAddress_attemptedAt_idx" ON "LoginAttempt"("ipAddress", "attemptedAt");
