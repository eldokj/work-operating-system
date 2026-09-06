import { z } from "zod";
import { AuditService, PermissionService } from "@ai-task-manager/domain";
import { PERMISSIONS } from "@ai-task-manager/shared";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

const querySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withAuth(async (req, { userId, params }) => {
  const permissions = new PermissionService(db);
  await permissions.assertOrgMember(userId, params.orgId);
  await permissions.assertCan(userId, params.orgId, PERMISSIONS.AUDIT_VIEW);

  const query = parseQuery(req, querySchema);
  const audit = new AuditService(db);
  return audit.listForOrganization(params.orgId, query);
});
