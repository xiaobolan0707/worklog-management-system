import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");

describe("production compose stack", () => {
  it("keeps PostgreSQL private and health-checks every long-running service", async () => {
    const compose = parse(await readFile(resolve(root, "compose.yaml"), "utf8"));

    expect(Object.keys(compose.services)).toEqual(
      expect.arrayContaining(["app", "postgres", "nginx", "backup"])
    );
    expect(compose.services.postgres.ports).toBeUndefined();
    expect(compose.services.postgres.healthcheck).toBeDefined();
    expect(compose.services.app.healthcheck).toBeDefined();
    expect(compose.services.nginx.healthcheck).toBeDefined();
    expect(compose.services.nginx.ports).toContain("80:80");
  });

  it("requires secrets instead of shipping fallback credentials", async () => {
    const compose = parse(await readFile(resolve(root, "compose.yaml"), "utf8"));
    const serialized = JSON.stringify(compose);

    expect(serialized).toContain("${POSTGRES_PASSWORD:?");
    expect(serialized).toContain("${SESSION_SECRET:?");
    expect(serialized).not.toMatch(/password\s*[:=]\s*(admin|secret|password)/i);
  });

  it("builds and runs the application as a non-root user", async () => {
    const dockerfile = await readFile(resolve(root, "Dockerfile"), "utf8");

    expect(dockerfile.match(/^FROM /gm)?.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    expect(dockerfile).toContain("/app/src ./src");
  });

  it("allows the validated image payload through the Nginx edge", async () => {
    const nginx = await readFile(resolve(root, "infra/nginx/default.conf"), "utf8");

    expect(nginx).toMatch(/client_max_body_size\s+70m;/);
  });
});
