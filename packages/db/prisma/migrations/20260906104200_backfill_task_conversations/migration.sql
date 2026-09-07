-- Backfill: every task that existed before this feature (Phase 1 demo/test data) gets
-- its primary conversation retroactively, so "every task has exactly one conversation"
-- holds for the whole table, not just tasks created after this migration. Idempotent —
-- safe to re-run (NOT EXISTS guard), matching the pattern used by the RBAC seed script.
INSERT INTO "task_conversations" ("id", "task_id", "organization_id", "created_at")
SELECT gen_random_uuid(), t.id, w.organization_id, now()
FROM "tasks" t
JOIN "workspaces" w ON w.id = t.workspace_id
WHERE NOT EXISTS (
  SELECT 1 FROM "task_conversations" tc WHERE tc.task_id = t.id
);
