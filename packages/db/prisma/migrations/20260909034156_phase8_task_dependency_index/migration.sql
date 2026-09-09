-- Phase 8 — docs/architecture/28-phase8-task-dependencies-architecture-report.md §3.
-- Purely additive: one index on the existing task_dependencies table (unused since
-- Phase 1). No data change, no destructive statement.

-- CreateIndex
CREATE INDEX "task_dependencies_depends_on_task_id_idx" ON "task_dependencies"("depends_on_task_id");
