import { reassignInternalSchema } from "@ai-task-manager/shared";
import { AssignmentService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Team Head (or equivalent) distributing an ACCEPTED team assignment to a member — doc 06 §6.3.
export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, reassignInternalSchema);
  const assignments = new AssignmentService(db);
  return assignments.reassignInternal(userId, params.assignmentId, input.assigneeUserId);
});
