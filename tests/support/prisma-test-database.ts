import { readFile, readdir } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PGlite, types as pgliteTypes } from "@electric-sql/pglite";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

/** Real generated Prisma queries and production migrations against embedded PostgreSQL. */
export async function createPrismaTestDatabase() {
  const embedded = new PGlite();
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  const names = (await readdir(migrations, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const name of names) await embedded.exec(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
  // PGlite has one connection: hold its queue until each Prisma transaction releases it.
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return release;
  }
  type Query = { text: string; values?: unknown[]; rowMode?: "array" | "object"; types?: { getTypeParser(oid: number, format: string): (value: string) => unknown } };
  async function query(input: string | Query) {
    const options = typeof input === "string" ? { text: input } : input;
    const parsers = options.types ? Object.fromEntries(Object.keys(pgliteTypes.parsers).map((oid) => [oid, options.types!.getTypeParser(Number(oid), "text")])) : undefined;
    const result = await embedded.query(options.text, options.values, {
      rowMode: options.rowMode ?? "object", ...(parsers ? { parsers } : {})
    });
    return { rows: result.rows, fields: result.fields.map((field) => ({ ...field, dataTypeID: field.dataTypeID })), rowCount: result.affectedRows ?? result.rows.length };
  }
  const pool = new pg.Pool();
  Object.defineProperty(pool, "query", { value: async (input: string | Query) => {
    const release = await acquire();
    try { return await query(input); } finally { release(); }
  } });
  Object.defineProperty(pool, "connect", { value: async () => {
    const release = await acquire();
    return Object.assign(new EventEmitter(), { query, release });
  } });
  const database = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    database,
    async close() { await database.$disconnect(); await pool.end(); await embedded.close(); }
  };
}
