import { randomUUID } from "node:crypto";

import type { AuditEvent, Prisma } from "../../generated/prisma/client.js";

export interface AuditInput {
  actorId?: string | null;
  subjectUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Prisma.InputJsonValue;
  ipAddress?: string | null;
  requestId?: string | null;
}

export type AuditTransaction = Pick<Prisma.TransactionClient, "auditEvent">;

export async function appendAudit(
  transaction: AuditTransaction,
  event: AuditInput
): Promise<AuditEvent> {
  return transaction.auditEvent.create({
    data: {
      id: randomUUID(),
      actorId: event.actorId ?? null,
      subjectUserId: event.subjectUserId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
      ipAddress: event.ipAddress ?? null,
      requestId: event.requestId ?? null
    }
  });
}
