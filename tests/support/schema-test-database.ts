import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";

import type {
  AuditTransaction,
  AuditInput
} from "../../src/modules/audit/audit.repository.js";

type Row = Record<string, unknown>;

export async function createSchemaTestDatabase() {
  const database = new PGlite();
  const migration = await readFile(
    new URL("../../prisma/migrations/20261010170000_initial/migration.sql", import.meta.url),
    "utf8"
  );
  await database.exec(migration);

  async function sql<T extends Row[] = Row[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> {
    const statement = strings.reduce(
      (result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ""),
      ""
    );
    const result = await database.query<Row>(statement, values);
    return result.rows as T;
  }

  const auditTransaction = {
    auditEvent: {
      async create({ data }: { data: AuditInput & { id?: string } }) {
        const id = data.id ?? randomUUID();
        const rows = await database.query<Row>(
          `INSERT INTO audit_events
            (id, actor_id, subject_user_id, action, entity_type, entity_id, metadata, ip_address, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
           RETURNING id, actor_id AS "actorId", subject_user_id AS "subjectUserId",
             action, entity_type AS "entityType", entity_id AS "entityId", metadata,
             ip_address AS "ipAddress", request_id AS "requestId", created_at AS "createdAt"`,
          [
            id,
            data.actorId ?? null,
            data.subjectUserId ?? null,
            data.action,
            data.entityType,
            data.entityId,
            JSON.stringify(data.metadata),
            data.ipAddress ?? null,
            data.requestId ?? null
          ]
        );
        return rows.rows[0];
      }
    }
  } as unknown as AuditTransaction;

  return {
    sql,
    auditTransaction,
    close: () => database.close()
  };
}
