import type { Prisma, PrismaClient, AuditSource } from "@ai-task-manager/db";

export interface AuditLogEntry {
  organizationId?: string | null;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  source?: AuditSource;
}

/**
 * Append-only audit trail — docs/architecture/12-security-strategy.md §12.7 and
 * docs/architecture/22 (brief). Every state-changing action in every other service calls
 * this. Immutability of the resulting rows is additionally enforced at the DB level (the
 * app connects as a role with no UPDATE/DELETE on audit_logs — see
 * docs/architecture/14-phase1-implementation-deviations.md #4).
 */
export class AuditService {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.db.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: entry.reason ?? null,
        source: entry.source ?? "API",
      },
    });
  }

  async listForOrganization(
    organizationId: string,
    filter: { entityType?: string; entityId?: string; actorId?: string; limit?: number; cursor?: string } = {}
  ) {
    const limit = filter.limit ?? 50;
    const rows = await this.db.auditLog.findMany({
      where: {
        organizationId,
        entityType: filter.entityType,
        entityId: filter.entityId,
        actorId: filter.actorId,
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, fullName: true, email: true } } },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  }
}
