import { ReportingService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const reporting = new ReportingService(db);
  return reporting.getOrganizationDashboard(userId, params.orgId);
});
