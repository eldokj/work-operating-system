import { updateProjectDateSchema } from "@ai-task-manager/shared";
import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Flat, item-level route resolving its own parent server-side — same convention as
// /messages/:id and /checklist-items/:id (doc 17 §16).
export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, updateProjectDateSchema);
  const projects = new ProjectService(db);
  return projects.updateDate(userId, params.dateId, input);
});

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  await projects.deleteDate(userId, params.dateId);
  return { success: true };
});
