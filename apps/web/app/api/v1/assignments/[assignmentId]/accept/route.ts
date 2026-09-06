import { AssignmentService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const POST = withAuth(async (_req, { userId, params }) => {
  const assignments = new AssignmentService(db);
  return assignments.accept(userId, params.assignmentId);
});
