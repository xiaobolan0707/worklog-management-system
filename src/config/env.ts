import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters"),
  ARCHIVE_STORAGE_DIR: z.string().min(1).optional(),
  ARCHIVE_LIFECYCLE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  /**
   * SEC-01：默认即要求 Secure Cookie。
   * 生产环境必须为 true（见下方 superRefine 启动校验），
   * 仅允许在明确的本地开发场景显式设为 false。
   */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** SEC-01：生产环境要求经 HTTPS 接入，非 https 的认证请求将被拒绝。 */
  REQUIRE_HTTPS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** SEC-03：自助注册邀请码。未配置时看 REGISTRATION_OPEN。 */
  REGISTRATION_INVITE_CODE: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(8).max(128).optional()
  ),
  /**
   * SEC-03：完全开放自助注册（无需邀请码）。默认关闭。
   * 开放后任何人都可提交注册申请，账号仍以停用状态创建，须管理员启用后方可登录。
   */
  REGISTRATION_OPEN: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** SEC-05：登录/审计类数据保留天数，超期由定时任务清理。 */
  SECURITY_LOG_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(180)
}).superRefine((env, context) => {
  /**
   * SEC-01：生产环境默认要求 Secure Cookie。
   * 只有显式关闭 REQUIRE_HTTPS（纯 HTTP 的验收环境）时才允许 COOKIE_SECURE=false：
   * 明文 HTTP 下浏览器根本不会保存 Secure Cookie，强制 true 会让登录直接失效。
   * 两项默认值都是 true，正常部署不受影响；绑定域名并启用 TLS 后请两项都保持 true。
   */
  if (env.NODE_ENV === "production" && !env.COOKIE_SECURE && env.REQUIRE_HTTPS) {
    context.addIssue({
      code: "custom",
      path: ["COOKIE_SECURE"],
      message: "生产环境必须设置 COOKIE_SECURE=true，否则会话 Cookie 将经明文 HTTP 传输"
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(input);
}
