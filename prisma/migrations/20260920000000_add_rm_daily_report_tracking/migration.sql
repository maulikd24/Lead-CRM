-- AlterEnum: additive ActivityType values, for the Daily RM Report's contact/meeting tracking
ALTER TYPE "ActivityType" ADD VALUE 'MEETING';
ALTER TYPE "ActivityType" ADD VALUE 'CONTACT';

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('FOLLOW_UP', 'MEETING', 'FUNDING', 'OTHER');

-- AlterTable: existing rows default to FOLLOW_UP, matching today's implicit behavior exactly
ALTER TABLE "Task" ADD COLUMN "category" "TaskCategory" NOT NULL DEFAULT 'FOLLOW_UP';
