import { Prisma, type PrismaClient } from "@ai-task-manager/db";
import { canAccessConversation } from "../permission-engine/conversation-access";
import { canAccessProject } from "../permission-engine/project-access";
import { PermissionService } from "./permission.service";
import { ProjectService } from "./project.service";
import { TaskService } from "./task.service";

// Phase 5 — docs/architecture/22-phase5-product-capability-and-roadmap-assessment.md §8.
// v1 search surface: tasks, projects, and (non-deleted) messages — the exact scope
// approved there; files/people/teams are explicitly deferred (doc 22 §8/§9), not an
// oversight. Ranking uses Postgres's own ts_rank, nothing custom (doc 22's open question
// #3, resolved this way as the documented default).

const CANDIDATE_OVERFETCH_MULTIPLIER = 3; // see explanation on `search()` below
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MESSAGE_SNIPPET_LENGTH = 140;

export type SearchResultType = "TASK" | "PROJECT" | "MESSAGE";

export interface SearchResultItem {
  type: SearchResultType;
  id: string;
  title: string;
  snippet: string | null;
  taskId: string | null;
  projectId: string | null;
  workspaceId: string;
}

interface RawTaskRow {
  id: string;
  title: string;
  description: string | null;
  workspace_id: string;
  rank: number;
}
interface RawProjectRow {
  id: string;
  name: string;
  description: string | null;
  workspace_id: string;
  rank: number;
}
interface RawMessageRow {
  id: string;
  body: string;
  task_id: string | null;
  project_id: string | null;
  workspace_id: string;
  rank: number;
}

/**
 * Search — docs/architecture/22-phase5-product-capability-and-roadmap-assessment.md.
 * Postgres native full-text search (expression GIN indexes over existing columns, no
 * stored tsvector column — see the migration) composed with the exact same authorization
 * predicates every other read path in this codebase already uses. This is the one
 * non-negotiable rule for this service (doc 22 §8/§10): a coarse, workspace-scoped SQL
 * pre-filter narrows candidates for performance, but it is NEVER treated as sufficient
 * authorization on its own — every candidate is individually re-verified through
 * TaskService.canViewTask / ProjectService.canAccessProject / canAccessConversation
 * before it can appear in a result set. A searcher can never see a title, snippet, or
 * even the existence of a task/project/message they couldn't otherwise view.
 */
export class SearchService {
  private readonly tasks: TaskService;
  private readonly projects: ProjectService;
  private readonly permissions: PermissionService;

  constructor(private readonly db: PrismaClient) {
    this.tasks = new TaskService(db);
    this.projects = new ProjectService(db);
    this.permissions = new PermissionService(db);
  }

  /** Every workspace the searcher could plausibly see anything in: their own personal
   * workspace (if any) plus every organization workspace they're an active member of.
   * This is only a coarse, performance-motivated SQL pre-filter — never the actual
   * authorization decision (that's the per-candidate re-check below). */
  private async getVisibleWorkspaceIds(actorId: string): Promise<string[]> {
    const [personal, memberships] = await Promise.all([
      this.db.workspace.findFirst({ where: { type: "PERSONAL", ownerUserId: actorId }, select: { id: true } }),
      this.db.organizationMember.findMany({ where: { userId: actorId, status: "ACTIVE" }, select: { organizationId: true } }),
    ]);
    const orgIds = memberships.map((m) => m.organizationId);
    const orgWorkspaces = orgIds.length
      ? await this.db.workspace.findMany({ where: { type: "ORGANIZATION", organizationId: { in: orgIds } }, select: { id: true } })
      : [];
    const ids = orgWorkspaces.map((w) => w.id);
    if (personal) ids.push(personal.id);
    return ids;
  }

  /**
   * Two-stage design, deliberately not a single query (doc 22 §8/§10):
   *  1. A coarse, workspace-scoped full-text match via raw SQL (fast, index-backed) —
   *     over-fetches `limit * 3` candidates per entity type, since stage 2 will discard
   *     some.
   *  2. A fine-grained per-candidate authorization re-check using this codebase's own,
   *     already-correct, already-tested predicates — never a parallel/shortcut rule.
   * No cursor pagination (doc 22 §8): this is a "top N ranked results" experience, the
   * same shape as a search-as-you-type box, not a paginated browse — matching the same
   * "small, human-scale, unpaginated" reasoning already used for a day's plan (doc 19).
   */
  async search(actorId: string, query: string, limit: number = DEFAULT_LIMIT): Promise<SearchResultItem[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const boundedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    const workspaceIds = await this.getVisibleWorkspaceIds(actorId);
    if (workspaceIds.length === 0) return [];

    const candidateLimit = boundedLimit * CANDIDATE_OVERFETCH_MULTIPLIER;
    const workspaceIdList = Prisma.join(workspaceIds);

    const [taskRows, projectRows, messageRows] = await Promise.all([
      this.db.$queryRaw<RawTaskRow[]>(Prisma.sql`
        SELECT id, title, description, workspace_id,
               ts_rank(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')), plainto_tsquery('english', ${trimmed})) AS rank
        FROM tasks
        WHERE workspace_id IN (${workspaceIdList})
          AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')) @@ plainto_tsquery('english', ${trimmed})
        ORDER BY rank DESC
        LIMIT ${candidateLimit}
      `),
      this.db.$queryRaw<RawProjectRow[]>(Prisma.sql`
        SELECT id, name, description, workspace_id,
               ts_rank(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')), plainto_tsquery('english', ${trimmed})) AS rank
        FROM projects
        WHERE workspace_id IN (${workspaceIdList})
          AND to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')) @@ plainto_tsquery('english', ${trimmed})
        ORDER BY rank DESC
        LIMIT ${candidateLimit}
      `),
      this.db.$queryRaw<RawMessageRow[]>(Prisma.sql`
        SELECT tm.id, tm.body, tc.task_id, tc.project_id, COALESCE(t.workspace_id, p.workspace_id) AS workspace_id,
               ts_rank(to_tsvector('english', coalesce(tm.body, '')), plainto_tsquery('english', ${trimmed})) AS rank
        FROM task_messages tm
        JOIN task_conversations tc ON tc.id = tm.conversation_id
        LEFT JOIN tasks t ON t.id = tc.task_id
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tm.is_deleted = false
          AND COALESCE(t.workspace_id, p.workspace_id) IN (${workspaceIdList})
          AND to_tsvector('english', coalesce(tm.body, '')) @@ plainto_tsquery('english', ${trimmed})
        ORDER BY rank DESC
        LIMIT ${candidateLimit}
      `),
    ]);

    // Batched candidate loading (doc 22 §8/§10/§18-equivalent performance discipline —
    // one query per entity type for the actual row data, never one query per candidate).
    // Every message's parent (task or project) is collected across ALL message rows
    // first, so even a mixed batch of task-scoped and project-scoped messages is still
    // just two more batched fetches, not N.
    const messageTaskIds = [...new Set(messageRows.map((r) => r.task_id).filter((id): id is string => !!id))];
    const messageProjectIds = [...new Set(messageRows.map((r) => r.project_id).filter((id): id is string => !!id))];

    const [candidateTasks, candidateProjects, messageParentTasks, messageParentProjects] = await Promise.all([
      this.tasks.getTasksRawByIds(taskRows.map((r) => r.id)),
      this.projects.getProjectsRawByIds(projectRows.map((r) => r.id)),
      this.tasks.getTasksRawByIds(messageTaskIds),
      this.projects.getProjectsRawByIds(messageProjectIds),
    ]);
    const taskById = new Map(candidateTasks.map((t) => [t.id, t]));
    const projectById = new Map(candidateProjects.map((p) => [p.id, p]));
    const messageTaskById = new Map(messageParentTasks.map((t) => [t.id, t]));
    const messageProjectById = new Map(messageParentProjects.map((p) => [p.id, p]));

    // The per-candidate authorization check itself still runs one at a time (each call
    // may do its own internal lookups, e.g. team membership) — the same accepted pattern
    // ProjectService.listProjectsForUser already uses for a bounded candidate set (doc 17
    // §16); what changed above is that the ROW DATA itself is no longer fetched per-item.
    const results: Array<SearchResultItem & { rank: number }> = [];

    for (const row of taskRows) {
      const task = taskById.get(row.id);
      if (!task || !(await this.tasks.canViewTask(actorId, task))) continue;
      results.push({
        type: "TASK",
        id: row.id,
        title: row.title,
        snippet: row.description,
        taskId: row.id,
        projectId: null,
        workspaceId: row.workspace_id,
        rank: Number(row.rank),
      });
    }

    for (const row of projectRows) {
      const project = projectById.get(row.id);
      if (!project || !(await this.projects.canAccessProject(actorId, project))) continue;
      results.push({
        type: "PROJECT",
        id: row.id,
        title: row.name,
        snippet: row.description,
        taskId: null,
        projectId: row.id,
        workspaceId: row.workspace_id,
        rank: Number(row.rank),
      });
    }

    for (const row of messageRows) {
      let allowed = false;
      if (row.task_id) {
        const task = messageTaskById.get(row.task_id);
        allowed = !!task && (await canAccessConversation(this.permissions, actorId, task));
      } else if (row.project_id) {
        const project = messageProjectById.get(row.project_id);
        allowed = !!project && (await canAccessProject(this.db, this.permissions, actorId, project));
      }
      if (!allowed) continue;
      results.push({
        type: "MESSAGE",
        id: row.id,
        title: row.body.length > MESSAGE_SNIPPET_LENGTH ? `${row.body.slice(0, MESSAGE_SNIPPET_LENGTH)}…` : row.body,
        snippet: null,
        taskId: row.task_id,
        projectId: row.project_id,
        workspaceId: row.workspace_id,
        rank: Number(row.rank),
      });
    }

    return results
      .sort((a, b) => b.rank - a.rank)
      .slice(0, boundedLimit)
      .map(({ rank: _rank, ...item }) => item);
  }
}
