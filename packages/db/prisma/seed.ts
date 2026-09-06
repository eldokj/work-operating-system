// Seeds the permission catalog and system role templates — docs/architecture/04-rbac-permissions.md.
// Idempotent (safe to run repeatedly): upserts by unique key/name.
import { PrismaClient } from "@prisma/client";
import { PERMISSION_CATALOG, SYSTEM_ROLE_TEMPLATES } from "@ai-task-manager/shared";

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${PERMISSION_CATALOG.length} permissions...`);
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description },
      create: { key: p.key, description: p.description },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const byKey = new Map(allPermissions.map((p) => [p.key, p]));

  console.log(`Seeding ${Object.keys(SYSTEM_ROLE_TEMPLATES).length} system role templates...`);
  for (const [roleName, permissionKeys] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
    let role = await prisma.role.findFirst({ where: { name: roleName, isSystem: true, organizationId: null } });
    if (!role) {
      role = await prisma.role.create({ data: { name: roleName, isSystem: true, organizationId: null } });
    }

    // Reset role_permissions to exactly match the template (idempotent re-seed).
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const permissionIds = permissionKeys
      .map((key) => byKey.get(key)?.id)
      .filter((id): id is string => !!id);
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: role!.id, permissionId })),
    });
    console.log(`  - ${roleName}: ${permissionIds.length} permissions`);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
