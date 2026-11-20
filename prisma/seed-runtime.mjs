import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "../dist/server/generated/prisma/client.js";
import { hashPassword } from "../dist/server/modules/auth/password.js";
const { DATABASE_URL, ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD } = process.env;
if (!DATABASE_URL || !ADMIN_USERNAME || !ADMIN_INITIAL_PASSWORD || ADMIN_INITIAL_PASSWORD.length < 12) {
  throw new Error("Database URL, administrator name and a password of at least 12 characters are required");
}
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
try {
  await database.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: {},
    create: { username: ADMIN_USERNAME, displayName: "系统管理员", passwordHash: await hashPassword(ADMIN_INITIAL_PASSWORD), role: Role.ADMIN, mustChangePassword: true }
  });
} finally {
  await database.$disconnect();
}
