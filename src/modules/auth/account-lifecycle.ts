import { AuthError } from "./auth.service.js";

export interface AccountLifecycle {
  accountStatus: "ACTIVE" | "DISABLED";
  employmentStatus?: "ACTIVE" | "DEPARTED";
  departureMarkedAt?: Date | null;
  loginDisabledAt?: Date | null;
  recycledAt?: Date | null;
  archivePurgingAt?: Date | null;
  archivePurgedAt?: Date | null;
  deletedAt?: Date | null;
}

export function assertAccountAccessible(user: AccountLifecycle, now: Date) {
  if (user.accountStatus === "DISABLED" || user.deletedAt || user.recycledAt || user.archivePurgingAt || user.archivePurgedAt ||
    (user.loginDisabledAt && user.loginDisabledAt <= now) ||
    (user.departureMarkedAt && user.departureMarkedAt.getTime() + 30 * 86_400_000 <= now.getTime())) {
    throw new AuthError(403, "ACCOUNT_DISABLED", "账号已停用");
  }
}
