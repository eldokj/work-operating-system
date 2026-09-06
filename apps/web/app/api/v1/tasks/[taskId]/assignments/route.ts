import { createAssignmentSchema } from "@ai-task-manager/shared";
import { AssignmentService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Assign (or mid-flight reassign) a task to a user or a team — doc 06.
export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createAssignmentSchema);
  const assignments = new AssignmentService(db);
  return assignments.assign(userId, params.taskId, input);
});
