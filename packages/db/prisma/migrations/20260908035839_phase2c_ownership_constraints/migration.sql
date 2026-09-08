-- Phase 2C — docs/architecture/17-phase2c-project-workspace-architecture-report.md §6.4/§6.5.
-- Mirrors the exact pattern of the Phase 1 workspaces_owner_xor_org_check constraint
-- (packages/db/prisma/migrations/20260906072700_constraints_and_audit_immutability):
-- Prisma's schema DSL cannot express a CHECK constraint, so it's added here directly.

-- A conversation belongs to exactly one of a task or a project, never both, never
-- neither. Existing rows all have task_id set and project_id null, so they already
-- satisfy this — verified by row count before/after this migration.
ALTER TABLE "task_conversations"
  ADD CONSTRAINT "conversations_task_xor_project_check"
  CHECK (
    (task_id IS NOT NULL AND project_id IS NULL)
    OR (task_id IS NULL AND project_id IS NOT NULL)
  );

-- An attachment belongs to exactly one of a task or a project — the exact invariant
-- doc 17 §13 asked for by construction (never a task_id/project_id pair that could
-- disagree about which context owns the file).
ALTER TABLE "task_attachments"
  ADD CONSTRAINT "task_attachments_task_xor_project_check"
  CHECK (
    (task_id IS NOT NULL AND project_id IS NULL)
    OR (task_id IS NULL AND project_id IS NOT NULL)
  );
