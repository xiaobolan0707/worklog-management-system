import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    restoreMocks: true,
    exclude: ["tests/e2e/**", "**/node_modules/**", "**/.git/**"]
  }
});
