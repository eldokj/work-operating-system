import { AuthService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId }) => {
  const auth = new AuthService(db);
  const user = await auth.getUserById(userId);
  if (!user) throw new Error("Session user not found");
  return { id: user.id, email: user.email, fullName: user.fullName, defaultTimezone: user.defaultTimezone };
});
