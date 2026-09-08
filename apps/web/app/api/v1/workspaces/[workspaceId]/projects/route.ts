import { createProjectSchema } from "@ai-task-manager/shared";
import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Extended in Phase 2C (doc 17 §16) to go through ProjectService rather than a raw
// db.project.create/findMany — the service transactionally creates the project's main
// Conversation and seeds the owner as a ProjectMember, and filters listings to what the
// caller actually has access to (doc 17 §2's "lists everything" gap, fixed in
// ProjectService.listProjectsForUser).
export const GET = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  return projects.listProjectsForUser(userId, params.workspaceId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createProjectSchema);
  const projects = new ProjectService(db);
  return projects.createProject(userId, params.workspaceId, input);
});
