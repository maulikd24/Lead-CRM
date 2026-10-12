-- RM funded-amount targets per quarter. Additive only: one new table. A team's target is the sum of its RMs' rows.
CREATE TABLE "RmTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quarterStart" TIMESTAMP(3) NOT NULL,
    "fundedAmount" DECIMAL(18,2) NOT NULL,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RmTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RmTarget_userId_quarterStart_key" ON "RmTarget"("userId", "quarterStart");
CREATE INDEX "RmTarget_quarterStart_idx" ON "RmTarget"("quarterStart");

ALTER TABLE "RmTarget" ADD CONSTRAINT "RmTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RmTarget" ADD CONSTRAINT "RmTarget_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
