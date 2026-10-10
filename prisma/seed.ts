import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, Role } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/password.js";

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
