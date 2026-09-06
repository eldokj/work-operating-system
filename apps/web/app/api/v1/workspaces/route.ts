import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

// Every workspace (personal + one per organization) the current user can see —
// backs the workspace switcher (doc 08 "Navigation shell").
export const GET = withAuth(async (_req, { userId }) => {
  const [personal, orgMemberships] = await Promise.all([
    db.workspace.findFirst({ where: { type: "PERSONAL", ownerUserId: userId } }),
    db.organizationMember.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: { include: { workspaces: true } } },
    }),
  ]);

  const organizationWorkspaces = orgMemberships.flatMap((m) =>
    m.organization.workspaces.map((w) => ({
      id: w.id,
      type: w.type,
      name: w.name,
      organizationId: m.organization.id,
      organizationName: m.organization.name,
      organizationSlug: m.organization.slug,
    }))
  );

  return {
    personal: personal ? { id: personal.id, type: personal.type, name: personal.name } : null,
    organizations: organizationWorkspaces,
  };
});
