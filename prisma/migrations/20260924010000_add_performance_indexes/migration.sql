-- CreateIndex
CREATE INDEX "AuditLog_action_timestamp_idx" ON "AuditLog"("action", "timestamp");

-- CreateIndex
CREATE INDEX "Client_priority_idx" ON "Client"("priority");

-- CreateIndex
CREATE INDEX "Client_clientType_idx" ON "Client"("clientType");

-- CreateIndex
CREATE INDEX "Client_investmentCategory_idx" ON "Client"("investmentCategory");

-- CreateIndex
CREATE INDEX "Client_leadSource_idx" ON "Client"("leadSource");

-- CreateIndex
CREATE INDEX "Client_status_stageEnteredAt_idx" ON "Client"("status", "stageEnteredAt");

-- CreateIndex
CREATE INDEX "Document_clientId_idx" ON "Document"("clientId");

-- CreateIndex
CREATE INDEX "Exception_clientId_status_idx" ON "Exception"("clientId", "status");

-- CreateIndex
CREATE INDEX "Exception_status_createdAt_idx" ON "Exception"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StageHistory_clientId_changedAt_idx" ON "StageHistory"("clientId", "changedAt");
