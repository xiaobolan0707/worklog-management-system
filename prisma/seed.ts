import { scrypt as scryptCallback, randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, Role } from "../src/generated/prisma/client.js";

const scrypt = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

const databaseUrl = process.env["DATABASE_URL"];
const username = process.env["ADMIN_USERNAME"];
const initialPassword = process.env["ADMIN_INITIAL_PASSWORD"];

if (!databaseUrl || !username || !initialPassword) {
  throw new Error("DATABASE_URL, ADMIN_USERNAME and ADMIN_INITIAL_PASSWORD are required to seed");
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

try {
  await database.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      displayName: "系统管理员",
      passwordHash: await hashPassword(initialPassword),
      role: Role.ADMIN,
      mustChangePassword: true
    }
  });
} finally {
  await database.$disconnect();
}
