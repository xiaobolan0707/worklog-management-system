import { describe, expect, it } from "vitest";

import { loadEnv } from "../../../src/config/env.js";

const validInput = {
  DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
  SESSION_SECRET: "a-secure-session-secret-with-32-characters"
};

describe("loadEnv", () => {
  it("rejects startup when DATABASE_URL is missing", () => {
    expect(() => loadEnv({ SESSION_SECRET: validInput.SESSION_SECRET })).toThrow(
      /DATABASE_URL/
    );
  });

  it("rejects startup when SESSION_SECRET is missing", () => {
    expect(() => loadEnv({ DATABASE_URL: validInput.DATABASE_URL })).toThrow(
      /SESSION_SECRET/
    );
  });

  it("parses valid configuration with safe defaults", () => {
    expect(loadEnv(validInput)).toEqual({
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 3000,
      DATABASE_URL: validInput.DATABASE_URL,
      SESSION_SECRET: validInput.SESSION_SECRET,
      COOKIE_SECURE: false
    });
  });
});
