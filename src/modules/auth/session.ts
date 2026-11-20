import { createHmac, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "worklog_session";
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
/** INFO-05：会话闲置超时，超过该时长无请求即需重新登录。 */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 会话 Token 的存储哈希。
 *
 * SEC-12：使用 SESSION_SECRET 作为 HMAC 密钥，而非裸 SHA256。
 * 这样该配置具备真实语义——轮换 SESSION_SECRET 会使全部既有会话立即失效，
 * 同时哈希值不再能被离线彩虹表反推。
 */
export function hashSessionToken(token: string, secret: string): string {
  if (!secret) throw new Error("SESSION_SECRET is required to hash session tokens");
  return createHmac("sha256", secret).update(token).digest("base64url");
}
