import type {
  AuditQuery,
  AuditQueryRecord,
  AuditQueryRepository
} from "../../src/modules/audit/audit.service.js";

export class InMemoryAuditQueryRepository implements AuditQueryRepository {
  readonly events: AuditQueryRecord[] = [];

  async search(query: AuditQuery) {
    const filtered = this.events
      .filter((event) => !query.actorId || event.actorId === query.actorId)
      .filter((event) => !query.subjectUserId || event.subjectUserId === query.subjectUserId)
      .filter((event) => !query.action || event.action === query.action)
      .filter((event) => !query.from || event.createdAt >= new Date(query.from))
      .filter((event) => !query.to || event.createdAt <= new Date(`${query.to}T23:59:59.999Z`))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: filtered.slice(start, start + query.pageSize),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize
    };
  }
}
