-- Phase 6 — docs/architecture/24-phase6-notifications-scheduler-architecture-report.md
-- §8/§14. Idempotency markers for the scheduler's deadline-approaching/overdue checks,
-- plus the index the tick's own query needs (dueDate had no prior index). Additive,
-- nullable, no backfill required — NULL correctly means "not yet notified" for every
-- existing row.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deadline_approaching_notified_at" TIMESTAMP(3),
ADD COLUMN     "overdue_notified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");
