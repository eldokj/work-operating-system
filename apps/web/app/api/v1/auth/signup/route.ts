import { NextRequest } from "next/server";
import { signupSchema } from "@ai-task-manager/shared";
import { AuthService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withPublic } from "@/lib/api";
import { setSessionCookie } from "@/lib/session";

export const POST = withPublic(async (req: NextRequest) => {
  const input = await parseJsonBody(req, signupSchema);
  const auth = new AuthService(db);
  const user = await auth.signup(input);
  await setSessionCookie(user.id);
  return { id: user.id, email: user.email, fullName: user.fullName };
});
