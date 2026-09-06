import { withPublic } from "@/lib/api";
import { clearSessionCookie } from "@/lib/session";

export const POST = withPublic(async () => {
  await clearSessionCookie();
  return { success: true };
});
