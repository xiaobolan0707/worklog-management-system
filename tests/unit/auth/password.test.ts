import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../../src/modules/auth/password.js";

describe("password hashing", () => {
  it("stores a salted hash that verifies only the original password", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-42");

    expect(hash).not.toContain("Correct-Horse-Battery-42");
    await expect(verifyPassword("Correct-Horse-Battery-42", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("uses a unique salt for equal passwords", async () => {
    const first = await hashPassword("same-password-42");
    const second = await hashPassword("same-password-42");

    expect(first).not.toBe(second);
  });
});
