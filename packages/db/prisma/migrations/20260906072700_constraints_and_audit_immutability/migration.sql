-- Workspace: exactly one of owner_user_id / organization_id must be set (doc 03 §3.2).
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_owner_xor_org_check"
  CHECK (
    (owner_user_id IS NOT NULL AND organization_id IS NULL)
    OR (owner_user_id IS NULL AND organization_id IS NOT NULL)
  );

-- Task origin fields are set once (at creation / first assignment) and must never be
-- overwritten afterward (doc 13 #9/#12, "Third Required Workflow" cross-department test).
-- A CHECK constraint cannot reference the previous row, so this is a trigger.
CREATE OR REPLACE FUNCTION prevent_task_origin_overwrite()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.origin_organization_id IS NOT NULL AND NEW.origin_organization_id IS DISTINCT FROM OLD.origin_organization_id THEN
    RAISE EXCEPTION 'origin_organization_id is immutable once set (task %)', OLD.id;
  END IF;
  IF OLD.origin_department_id IS NOT NULL AND NEW.origin_department_id IS DISTINCT FROM OLD.origin_department_id THEN
    RAISE EXCEPTION 'origin_department_id is immutable once set (task %)', OLD.id;
  END IF;
  IF OLD.origin_team_id IS NOT NULL AND NEW.origin_team_id IS DISTINCT FROM OLD.origin_team_id THEN
    RAISE EXCEPTION 'origin_team_id is immutable once set (task %)', OLD.id;
  END IF;
  IF OLD.origin_assignor_id IS NOT NULL AND NEW.origin_assignor_id IS DISTINCT FROM OLD.origin_assignor_id THEN
    RAISE EXCEPTION 'origin_assignor_id is immutable once set (task %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_task_origin_overwrite ON "tasks";
CREATE TRIGGER trg_prevent_task_origin_overwrite
BEFORE UPDATE ON "tasks"
FOR EACH ROW
EXECUTE FUNCTION prevent_task_origin_overwrite();

-- Least-privilege runtime role for the running application (doc 12 §12.7 / brief §22:
-- "audit logs must be immutable from normal application users"). Migrations continue to
-- run as the table-owning role (DATABASE_URL); the Next.js app connects at request time
-- as app_runtime (DATABASE_RUNTIME_URL), which structurally cannot UPDATE or DELETE
-- audit_logs rows even if application code had a bug that tried to.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_password';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
REVOKE UPDATE, DELETE ON "audit_logs" FROM app_runtime;
GRANT SELECT, INSERT ON "audit_logs" TO app_runtime;

-- Keep the same least-privilege posture for tables created by future migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
