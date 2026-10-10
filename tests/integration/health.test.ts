import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /api/health", () => {
  it("reports that the application process is healthy", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
      SESSION_SECRET: "a-secure-session-secret-with-32-characters"
    });
    const app = await buildApp({ env });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
