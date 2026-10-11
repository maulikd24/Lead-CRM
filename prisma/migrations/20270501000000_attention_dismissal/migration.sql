-- Attention Engine v1 (Wave 2 C). Additive only: one new table for a person's own dismiss or snooze of an attention item. No foreign key.

-- CreateTable
CREATE TABLE "AttentionDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snoozeUntil" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttentionDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttentionDismissal_userId_status_idx" ON "AttentionDismissal"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttentionDismissal_userId_itemKey_key" ON "AttentionDismissal"("userId", "itemKey");
