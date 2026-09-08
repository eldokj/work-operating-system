import { updateProjectSchema } from "@ai-task-manager/shared";
import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  return projects.getProjectByIdOrThrow(userId, params.projectId);
});

export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, updateProjectSchema);
  const projects = new ProjectService(db);
  return projects.updateProject(userId, params.projectId, input);
});

// "Deletion" is archival (status=ARCHIVED), matching every other soft-delete/status
// transition in this codebase — never a hard delete (doc 17 §16).
export const DELETE = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  return projects.archiveProject(userId, params.projectId);
});
