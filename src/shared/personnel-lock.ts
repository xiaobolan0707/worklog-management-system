import type { Prisma } from "../generated/prisma/client.js";

export async function lockPersonnelTransition(transaction: Prisma.TransactionClient) {
  // Submissions, approval decisions and departures must see one consistent handover order.
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(20261104)::text`;
}

export async function lockPersonnelActivity(transaction: Prisma.TransactionClient) {
  // Ordinary work can proceed concurrently; employment transitions wait until it commits.
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock_shared(20261104)::text`;
}
