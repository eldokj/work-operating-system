-- CreateEnum
CREATE TYPE "DailyPlanItemStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED_TODAY', 'CARRIED_FORWARD', 'MOVED_TO_BACKLOG', 'DROPPED_FOR_TODAY');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "workday_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "working_hours" JSONB;

-- CreateTable
CREATE TABLE "workdays" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "started_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "reflection_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workdays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_plan_items" (
    "id" TEXT NOT NULL,
    "workday_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "DailyPlanItemStatus" NOT NULL DEFAULT 'PLANNED',
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_unplanned" BOOLEAN NOT NULL DEFAULT false,
    "planned_duration_minutes" INTEGER,
    "scheduled_start" TIMESTAMP(3),
    "scheduled_end" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "carried_from_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workdays_user_id_work_date_key" ON "workdays"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "daily_plan_items_workday_id_position_idx" ON "daily_plan_items"("workday_id", "position");

-- CreateIndex
CREATE INDEX "daily_plan_items_task_id_idx" ON "daily_plan_items"("task_id");

-- CreateIndex
CREATE INDEX "daily_plan_items_carried_from_item_id_idx" ON "daily_plan_items"("carried_from_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_plan_items_workday_id_task_id_key" ON "daily_plan_items"("workday_id", "task_id");

-- CreateIndex
CREATE INDEX "audit_logs_workday_id_created_at_idx" ON "audit_logs"("workday_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workdays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workdays" ADD CONSTRAINT "workdays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_plan_items" ADD CONSTRAINT "daily_plan_items_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workdays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_plan_items" ADD CONSTRAINT "daily_plan_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_plan_items" ADD CONSTRAINT "daily_plan_items_carried_from_item_id_fkey" FOREIGN KEY ("carried_from_item_id") REFERENCES "daily_plan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

