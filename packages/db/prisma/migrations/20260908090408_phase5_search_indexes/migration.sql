-- Phase 5 — docs/architecture/22-phase5-product-capability-and-roadmap-assessment.md §8.
-- Expression (functional) GIN indexes over EXISTING columns — no new column, no stored
-- tsvector, no generated-column/trigger maintenance. Postgres indexes the result of
-- to_tsvector(...) directly; SearchService's queries use the identical expression so the
-- planner matches the index automatically. Hand-written (like the CHECK-constraint
-- migrations before it) because Prisma's schema DSL has no representation for this — the
-- Prisma schema itself is completely unchanged by this migration.
--
-- Authorization note: these indexes only accelerate matching. They grant no access on
-- their own — SearchService re-derives authorization for every candidate row through the
-- exact same predicates (canViewTask / canAccessProject / canAccessConversation) every
-- other read path in this codebase already uses (doc 22 §8/§10's non-negotiable rule).

CREATE INDEX "tasks_search_idx" ON "tasks"
  USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '')));

CREATE INDEX "projects_search_idx" ON "projects"
  USING GIN (to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", '')));

-- Partial index: only non-deleted messages are ever searchable (a soft-deleted message
-- already hides its body from every other read path — doc 15 — search must not become
-- the one place that content still leaks).
CREATE INDEX "task_messages_search_idx" ON "task_messages"
  USING GIN (to_tsvector('english', coalesce("body", '')))
  WHERE "is_deleted" = false;
