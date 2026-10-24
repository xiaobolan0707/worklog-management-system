import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    restoreMocks: true,
    include: ["tests/{unit,integration,infra}/**/*.test.{ts,tsx}"]
  }
});
