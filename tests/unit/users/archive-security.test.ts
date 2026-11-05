import { describe, expect, it } from "vitest";
import { validateAttachment } from "../../../src/modules/archives/archive-storage.js";
import { assertAccountAccessible } from "../../../src/modules/auth/account-lifecycle.js";

describe("archive trust boundaries", () => {
  it("checks file contents, safe names and sizes rather than trusting extension", () => {
    expect(validateAttachment("简历.pdf", Buffer.from("%PDF-1.7\npreview\n%%EOF")).mimeType).toBe("application/pdf");
    expect(() => validateAttachment("简历.pdf", Buffer.from("<script>alert(1)</script>"))).toThrow();
    expect(() => validateAttachment("../简历.pdf", Buffer.from("%PDF-1.7"))).toThrow();
    expect(() => validateAttachment("简历.pdf\r\nx:test", Buffer.from("%PDF-1.7"))).toThrow();
    expect(() => validateAttachment("简历.pdf", Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow();
    expect(() => validateAttachment("学历.docx", Buffer.from("PK\x03\x04not-a-docx"))).toThrow();
  });
  it("denies login and existing sessions at exactly 30 days, without waiting for the job", () => {
    const user = { accountStatus: "ACTIVE" as const, departureMarkedAt: new Date("2026-01-01T00:00:00Z"), employmentStatus: "DEPARTED" as const };
    expect(() => assertAccountAccessible(user, new Date("2026-01-30T23:59:59.999Z"))).not.toThrow();
    expect(() => assertAccountAccessible(user, new Date("2026-01-31T00:00:00Z"))).toThrow("账号已停用");
    expect(() => assertAccountAccessible({ accountStatus: "ACTIVE", recycledAt: new Date() }, new Date())).toThrow();
  });
});
