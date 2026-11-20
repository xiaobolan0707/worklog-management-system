import type { PrismaClient } from "../../generated/prisma/client.js";

export interface AuditQuery {
  actorId?: string | undefined;
  subjectUserId?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  pageSize: number;
}

export interface AuditUserSummary {
  displayName: string | null;
  username: string;
}

export interface AuditQueryRecord {
  id: string;
  actorId: string | null;
  subjectUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
  /** 列表直接展示姓名，避免前端只能拿到 cuid。 */
  actor?: AuditUserSummary | null;
  subjectUser?: AuditUserSummary | null;
}

export interface AuditQueryRepository {
  search(query: AuditQuery): Promise<{
    items: AuditQueryRecord[];
    total: number;
    page: number;
    pageSize: number;
  }>;
}

export class AuditService {
  constructor(private readonly repository: AuditQueryRepository) {}
  search(query: AuditQuery) {
    return this.repository.search(query);
  }
}

export class PrismaAuditQueryRepository implements AuditQueryRepository {
  constructor(private readonly database: PrismaClient) {}

  async search(query: AuditQuery) {
    const where = {
      AND: [
        { OR: [{ subjectUserId: null }, { subjectUser: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } }] },
        { OR: [{ actorId: null }, { actor: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } }] }
      ],
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.subjectUserId ? { subjectUserId: query.subjectUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(
        query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {})
              }
            }
          : {}
      )
    };
    const [items, total] = await this.database.$transaction([
      this.database.auditEvent.findMany({
        where,
        include: {
          actor: { select: { displayName: true, username: true } },
          subjectUser: { select: { displayName: true, username: true } }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.database.auditEvent.count({ where })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
