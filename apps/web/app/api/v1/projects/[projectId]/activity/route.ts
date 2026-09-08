import { z } from "zod";
import { AuditService, ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// Mirrors /tasks/:taskId/activity (doc 17 §16) — access is project access (re-derived,
// never cached), then AuditService.listForProject does the actual read.
export const GET = withAuth(async (req, { userId, params }) => {
  const query = parseQuery(req, querySchema);
  const projects = new ProjectService(db);
  await projects.getProjectByIdOrThrow(userId, params.projectId); // authorization only
  const audit = new AuditService(db);
  return audit.listForProject(params.projectId, query);
});
