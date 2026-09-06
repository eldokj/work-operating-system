import { z } from "zod";
import { AuditService, ForbiddenError, NotFoundError, PermissionService } from "@ai-task-manager/domain";
import { PERMISSIONS } from "@ai-task-manager/shared";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
});

export const GET = withAuth(async (_req, { userId, params }) => {
  const workspace = await db.workspace.findUnique({ where: { id: params.workspaceId } });
  if (!workspace) throw new NotFoundError("Workspace not found");
  if (workspace.type === "PERSONAL") {
    if (workspace.ownerUserId !== userId) throw new ForbiddenError("You do not own this workspace");
  } else {
    const permissions = new PermissionService(db);
    await permissions.assertOrgMember(userId, workspace.organizationId!);
  }
  return db.project.findMany({ where: { workspaceId: params.workspaceId }, orderBy: { createdAt: "desc" } });
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createProjectSchema);
  const workspace = await db.workspace.findUnique({ where: { id: params.workspaceId } });
  if (!workspace) throw new NotFoundError("Workspace not found");

  if (workspace.type === "PERSONAL") {
    if (workspace.ownerUserId !== userId) throw new ForbiddenError("You do not own this workspace");
  } else {
    const permissions = new PermissionService(db);
    await permissions.assertOrgMember(userId, workspace.organizationId!);
    await permissions.assertCan(userId, workspace.organizationId!, PERMISSIONS.PROJECT_CREATE, {
      teamId: input.teamId,
      departmentId: input.departmentId,
    });
  }

  const project = await db.project.create({
    data: {
      workspaceId: params.workspaceId,
      name: input.name,
      description: input.description,
      departmentId: input.departmentId,
      teamId: input.teamId,
      ownerId: userId,
    },
  });

  const audit = new AuditService(db);
  await audit.log({
    organizationId: workspace.organizationId,
    actorId: userId,
    action: "project.created",
    entityType: "Project",
    entityId: project.id,
    after: { name: project.name },
  });

  return project;
});
