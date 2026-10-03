-- CreateEnum
CREATE TYPE "UserEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PAGE_VIEW', 'DATA_CREATE', 'DATA_UPDATE', 'DATA_DELETE', 'EXPORT');

-- CreateTable
CREATE TABLE "UserEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userRole" "Role",
    "type" "UserEventType" NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "path" TEXT,
    "summary" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserEvent_userId_createdAt_idx" ON "UserEvent"("userId", "createdAt");
CREATE INDEX "UserEvent_type_createdAt_idx" ON "UserEvent"("type", "createdAt");
CREATE INDEX "UserEvent_entity_entityId_idx" ON "UserEvent"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
