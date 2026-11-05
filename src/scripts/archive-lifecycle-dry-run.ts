import "dotenv/config";
import { resolve } from "node:path";
import { loadEnv } from "../config/env.js";
import { createDatabase } from "../plugins/database.js";
import { ArchiveStorage } from "../modules/archives/archive-storage.js";
import { PersonnelService } from "../modules/personnel/personnel.service.js";

const env = loadEnv();
const database = createDatabase(env);
try {
  const service = new PersonnelService(database, new ArchiveStorage(env.ARCHIVE_STORAGE_DIR ?? resolve("data/employee-archives")));
  process.stdout.write(JSON.stringify(await service.runJobs(new Date(), true), null, 2) + "\n");
} finally { await database.$disconnect(); }
