import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "worklog_session";
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
