import { z } from "zod";
import { ReportingService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

const querySchema = z.object({ workspaceId: z.string().uuid() });

export const GET = withAuth(async (req, { userId }) => {
  const { workspaceId } = parseQuery(req, querySchema);
  const reporting = new ReportingService(db);
  return reporting.getPersonalDashboard(userId, workspaceId);
});
