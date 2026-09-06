import { declineAssignmentSchema } from "@ai-task-manager/shared";
import { AssignmentService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, declineAssignmentSchema);
  const assignments = new AssignmentService(db);
  return assignments.decline(userId, params.assignmentId, input.reason);
});
