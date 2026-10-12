-- CreateTable
CREATE TABLE "AbExperiment" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbExperimentArm" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AbExperimentArm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbExperimentExposure" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "armKey" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "exposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbExperimentExposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbExperimentOutcome" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "armKey" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbExperimentOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbExperiment_key_key" ON "AbExperiment"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AbExperimentArm_experimentId_key_key" ON "AbExperimentArm"("experimentId", "key");

-- CreateIndex
CREATE INDEX "AbExperimentExposure_experimentId_armKey_idx" ON "AbExperimentExposure"("experimentId", "armKey");

-- CreateIndex
CREATE UNIQUE INDEX "AbExperimentExposure_experimentId_subjectId_key" ON "AbExperimentExposure"("experimentId", "subjectId");

-- CreateIndex
CREATE INDEX "AbExperimentOutcome_experimentId_subjectId_idx" ON "AbExperimentOutcome"("experimentId", "subjectId");

-- AddForeignKey
ALTER TABLE "AbExperimentArm" ADD CONSTRAINT "AbExperimentArm_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "AbExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbExperimentExposure" ADD CONSTRAINT "AbExperimentExposure_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "AbExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbExperimentOutcome" ADD CONSTRAINT "AbExperimentOutcome_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "AbExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

