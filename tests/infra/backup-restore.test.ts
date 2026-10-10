import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("PostgreSQL backup and restore operations", () => {
  it("retains backups for 30 days by default and never writes a partial final file", async () => {
    const script = await readFile(resolve(root, "infra/scripts/backup-postgres.sh"), "utf8");

    expect(script).toContain('BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"');
    expect(script).toContain("pg_dump");
    expect(script).toContain(".partial");
    expect(script).toContain("mv \"$partial_file\" \"$backup_file\"");
    expect(script).toContain("find \"$BACKUP_DIR\"");
  });

  it("validates a backup before restoring and reports database failures", async () => {
    const script = await readFile(resolve(root, "infra/scripts/restore-postgres.sh"), "utf8");

    expect(script).toContain("pg_restore --list");
    expect(script).toContain("pg_isready");
    expect(script).toMatch(/备份文件损坏|invalid backup/i);
    expect(script).toMatch(/数据库不可用|database unavailable/i);
  });
});
