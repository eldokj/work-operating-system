import { createTaskSchema, taskListFilterSchema } from "@ai-task-manager/shared";
import { ProjectService, TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, parseQuery, withAuth } from "@/lib/api";

// Thin filter over the existing task-listing/creation infrastructure — NOT a new task
// store (doc 17 §16). Task.projectId already existed pre-Phase 2C; this route just scopes
// TaskService's own list/create to a resolved project's workspace, the same way every
// other project-scoped route here resolves its parent via ProjectService first.
const createProjectTaskSchema = createTaskSchema.omit({ workspaceId: true, projectId: true });

export const GET = withAuth(async (req, { userId, params }) => {
  const filter = parseQuery(req, taskListFilterSchema);
  const projects = new ProjectService(db);
  const project = await projects.getProjectByIdOrThrow(userId, params.projectId);
  const tasks = new TaskService(db);
  return tasks.listTasks(userId, project.workspaceId, { ...filter, projectId: project.id });
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createProjectTaskSchema);
  const projects = new ProjectService(db);
  const project = await projects.getProjectByIdOrThrow(userId, params.projectId);
  const tasks = new TaskService(db);
  return tasks.createTask(userId, { ...input, workspaceId: project.workspaceId, projectId: project.id });
});
