import { NextRequest } from "next/server";
import { loginSchema } from "@ai-task-manager/shared";
import { AuthService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withPublic } from "@/lib/api";
import { setSessionCookie } from "@/lib/session";

export const POST = withPublic(async (req: NextRequest) => {
  const input = await parseJsonBody(req, loginSchema);
  const auth = new AuthService(db);
  const identity = await auth.verifyCredentials(input.email, input.password);
  await setSessionCookie(identity.id);
  return identity;
});
