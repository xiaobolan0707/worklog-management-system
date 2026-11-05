import { describe, expect, it } from "vitest";

import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { InMemoryAdministrationRepository } from "../../support/in-memory-administration-repository.js";
import { InMemoryAuthRepository } from "../../support/in-memory-auth-repository.js";
import { InMemoryLogRepository } from "../../support/in-memory-log-repository.js";
import { InMemoryReminderRepository } from "../../support/in-memory-reminder-repository.js";

const NOW = new Date("2026-10-10T04:00:00.000Z"); // 2026-10-10 12:00 北京时间

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
  SESSION_SECRET: "a-secure-session-secret-with-32-characters"
});

type Role = "EMPLOYEE" | "LEADER" | "MANAGEMENT" | "ADMIN" | "HR";

const seed: { id: string; username: string; role: Role; departmentId?: string | null }[] = [
  { id: "emp-1", username: "employee1", role: "EMPLOYEE", departmentId: "dep-1" },
  { id: "emp-2", username: "employee2", role: "EMPLOYEE", departmentId: "dep-1" },
  { id: "leader-1", username: "leader1", role: "LEADER", departmentId: "dep-1" },
  { id: "leader-2", username: "leader2", role: "LEADER", departmentId: "dep-1" },
  { id: "mgmt-1", username: "management1", role: "MANAGEMENT" },
  { id: "admin-1", username: "admin1", role: "ADMIN" },
  { id: "hr-1", username: "hr1", role: "HR" }
];

async function setup() {
  const authRepository = new InMemoryAuthRepository();
  for (const user of seed) {
    authRepository.addUser({
      ...user,
      displayName: user.username,
      passwordHash: await hashPassword("User-password-42"),
      accountStatus: "ACTIVE",
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null
    } as never);
  }
  const administrationRepository = new InMemoryAdministrationRepository(authRepository);
  administrationRepository.departments.set("dep-1", { id: "dep-1", name: "研发部" });
  for (const user of seed) {
    const record = authRepository.users.get(user.id)!;
    administrationRepository.users.set(user.id, {
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      passwordHash: record.passwordHash,
      role: record.role,
      accountStatus: record.accountStatus,
      departmentId: user.departmentId ?? null,
      mustChangePassword: record.mustChangePassword
    });
  }
  administrationRepository.approvers.set("emp-1", [{ approverId: "leader-1", position: 1 }]);
  const reminderRepository = new InMemoryReminderRepository();
  const logRepository = new InMemoryLogRepository(reminderRepository);
  logRepository.approvers.set("emp-1", [{ approverId: "leader-1", position: 1 }]);
  const app = await buildApp({
    env,
    now: () => NOW,
    authRepository,
    administrationRepository,
    logRepository,
    reminderRepository
  });
  return { app, authRepository, administrationRepository, logRepository, reminderRepository };
}

async function login(app: Awaited<ReturnType<typeof setup>>["app"], username: string, password = "User-password-42") {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [String(header)];
  return {
    status: response.statusCode,
    body: response.json<Record<string, unknown>>(),
    cookie: values.find((value) => value.startsWith("worklog_session="))?.split(";")[0] ?? "",
    csrfToken: (response.json<{ csrfToken?: string }>().csrfToken ?? "")
  };
}

const validItems = Array.from({ length: 4 }, (_, index) => ({
  content: `第 ${index + 1} 项工作完成了需求梳理、开发联调与验证，共计二十字以上`,
  completed: true,
  images: []
}));

describe("QA 审计：权限、输入校验与错误处理实测", () => {
  it("汇总实测结果", async () => {
    const { app, authRepository, administrationRepository, logRepository } = await setup();
    const results: string[] = [];
    const record = (name: string, actual: unknown) => results.push(`${name} => ${String(actual)}`);

    const emp1 = await login(app, "employee1");
    const emp2 = await login(app, "employee2");
    const leader1 = await login(app, "leader1");
    const leader2 = await login(app, "leader2");
    const mgmt = await login(app, "management1");
    const admin = await login(app, "admin1");
    const hr = await login(app, "hr1");

    // 1. 建日志：正常提交
    const draft = await app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { workDate: "2026-10-10", items: validItems }
    });
    record("创建草稿(正常)", draft.statusCode);
    const logId = draft.json<{ log: { id: string } }>().log.id;

    // 2. 越权读取他人日志（IDOR）
    const idor = await app.inject({ method: "GET", url: `/api/logs/${logId}`, headers: { cookie: emp2.cookie } });
    record("员工2读取员工1日志", `${idor.statusCode} ${idor.json<{ code?: string }>().code ?? ""}`);

    // 3. 未分配审批关系的领导读取
    const leaderIdor = await app.inject({ method: "GET", url: `/api/logs/${logId}`, headers: { cookie: leader2.cookie } });
    record("非审批领导读取日志", `${leaderIdor.statusCode} ${leaderIdor.json<{ code?: string }>().code ?? ""}`);

    // 4. 角色矩阵
    const adminAsLeader = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: leader1.cookie } });
    record("领导访问用户管理", adminAsLeader.statusCode);
    const empAsHr = await app.inject({ method: "GET", url: "/api/hr/personnel", headers: { cookie: emp1.cookie } });
    record("员工访问人事台账", empAsHr.statusCode);
    const mgmtAsAdmin = await app.inject({ method: "GET", url: "/api/admin/settings", headers: { cookie: mgmt.cookie } });
    record("管理层访问系统设置", mgmtAsAdmin.statusCode);
    const hrAsLogs = await app.inject({ method: "GET", url: "/api/logs", headers: { cookie: hr.cookie } });
    record("人事访问日志列表", `${hrAsLogs.statusCode} ${hrAsLogs.json<{ code?: string }>().code ?? ""}`);

    // 5. 缺少 CSRF
    const noCsrf = await app.inject({
      method: "POST", url: "/api/logs/drafts", headers: { cookie: emp1.cookie },
      payload: { workDate: "2026-10-09", items: validItems }
    });
    record("无 CSRF 头提交草稿", `${noCsrf.statusCode} ${noCsrf.json<{ code?: string }>().code ?? ""}`);

    // 6. 输入校验边界
    const shortContent = await app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { workDate: "2026-10-08", items: validItems.map(() => ({ content: "太短", completed: true, images: [] })) }
    });
    record("草稿内容过短(4项均2字)", shortContent.statusCode);
    const tooFew = await app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { workDate: "2026-10-08", items: validItems.slice(0, 3) }
    });
    record("草稿仅3项(最少4项)", tooFew.statusCode);
    const badPage = await app.inject({ method: "GET", url: "/api/logs/mine?pageSize=1000", headers: { cookie: emp1.cookie } });
    record("分页 pageSize=1000", badPage.statusCode);
    const badDateDraft = await app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { workDate: "2026-02-30", items: validItems }
    });
    record("非法日期 2026-02-30", badDateDraft.statusCode);

    // 7. 未来日期草稿 + 提交
    const future = await app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { workDate: "2026-12-31", items: validItems }
    });
    record("未来日期(2026-12-31)建草稿", future.statusCode);
    const futureId = future.json<{ log: { id: string } }>().log.id;
    const futureSubmit = await app.inject({
      method: "POST", url: `/api/logs/${futureId}/submit`,
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken }, payload: {}
    });
    record("提交未来日期日志", `${futureSubmit.statusCode} ${futureSubmit.json<{ code?: string }>().code ?? ""}`);

    // 8. 超出 30 天的补写
    const old = await app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { workDate: "2026-08-01", items: validItems }
    });
    const oldId = old.json<{ log: { id: string } }>().log.id;
    const oldSubmit = await app.inject({
      method: "POST", url: `/api/logs/${oldId}/submit`,
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken }, payload: { backfillReason: "忘记填写" }
    });
    record("补写 70 天前日志(带原因)", `${oldSubmit.statusCode} ${oldSubmit.json<{ code?: string }>().code ?? ""}`);

    // 9. 少于 20 字提交
    const thin = await app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { workDate: "2026-10-07", items: validItems.map(() => ({ content: "写得太少", completed: true, images: [] })) }
    });
    const thinId = thin.json<{ log: { id: string } }>().log.id;
    const thinSubmit = await app.inject({
      method: "POST", url: `/api/logs/${thinId}/submit`,
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken }, payload: {}
    });
    record("提交每项<20字", `${thinSubmit.statusCode} ${thinSubmit.json<{ code?: string }>().code ?? ""}`);

    // 10. 正常提交
    const okSubmit = await app.inject({
      method: "POST", url: `/api/logs/${logId}/submit`,
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken }, payload: {}
    });
    record("正常提交日志", okSubmit.statusCode);
    const dupSubmit = await app.inject({
      method: "POST", url: `/api/logs/${logId}/submit`,
      headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken }, payload: {}
    });
    record("重复提交同一日志", `${dupSubmit.statusCode} ${dupSubmit.json<{ code?: string }>().code ?? ""}`);

    // 11. 登录枚举：不存在用户 vs 存在用户锁定
    const ghostFails = [];
    for (let i = 0; i < 6; i++) ghostFails.push((await login(app, "no-such-user", "wrong-password")).status);
    record("不存在用户连续6次失败状态码", ghostFails.join(","));
    const realFails = [];
    for (let i = 0; i < 6; i++) realFails.push((await login(app, "employee2", "wrong-password")).status);
    record("存在用户连续6次失败状态码", realFails.join(","));

    // 12. 注册用户名校验
    const dupRegister = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: { displayName: "张三", username: "employee1", password: "abcdef", confirmPassword: "abcdef" }
    });
    record("注册已存在用户名", `${dupRegister.statusCode} ${dupRegister.json<{ code?: string }>().code ?? ""}`);
    const weakRegister = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: { displayName: "李四", username: "newuser01", password: "111111", confirmPassword: "111111" }
    });
    record("注册弱密码 111111", weakRegister.statusCode);

    // 13. 自助改密接口是否存在
    const selfChange = await app.inject({
      method: "POST", url: "/api/auth/change-password", headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { currentPassword: "User-password-42", newPassword: "Another-pass-42" }
    });
    record("普通用户自助改密接口", selfChange.statusCode);
    const initialChange = await app.inject({
      method: "POST", url: "/api/auth/change-initial-password", headers: { cookie: emp1.cookie, "x-csrf-token": emp1.csrfToken },
      payload: { currentPassword: "User-password-42", newPassword: "Another-pass-42" }
    });
    record("已改初始密码后再调初始改密", `${initialChange.statusCode} ${initialChange.json<{ code?: string }>().code ?? ""}`);

    // 14. 强制改密用户的边界
    const forced = await app.inject({
      method: "POST", url: "/api/admin/users",
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      payload: { username: "forced01", displayName: "待改密", initialPassword: "Init-pass-42", role: "EMPLOYEE" }
    });
    record("管理员创建用户", forced.statusCode);
    const forcedLogin = await login(app, "forced01", "Init-pass-42");
    record("待改密用户登录", forcedLogin.status);
    const forcedLogs = await app.inject({ method: "GET", url: "/api/logs/mine", headers: { cookie: forcedLogin.cookie } });
    record("待改密用户访问日志", `${forcedLogs.statusCode} ${forcedLogs.json<{ code?: string }>().code ?? ""}`);
    const forcedReminders = await app.inject({ method: "GET", url: "/api/reminders", headers: { cookie: forcedLogin.cookie } });
    record("待改密用户访问提醒(requireUser)", forcedReminders.statusCode);
    const forcedDraft = await app.inject({
      method: "POST", url: "/api/logs/drafts", headers: { cookie: forcedLogin.cookie, "x-csrf-token": forcedLogin.csrfToken },
      payload: { workDate: "2026-10-10", items: validItems }
    });
    record("待改密用户创建草稿", `${forcedDraft.statusCode} ${forcedDraft.json<{ code?: string }>().code ?? ""}`);

    // 15. 越权改角色（批量赋值）
    const massAssign = await app.inject({
      method: "PATCH", url: "/api/departments/dep-1/employees/emp-2",
      headers: { cookie: leader1.cookie, "x-csrf-token": leader1.csrfToken },
      payload: { username: "employee2", displayName: "员工2", departmentId: "dep-1", role: "ADMIN" }
    });
    record("领导批量赋值改角色", massAssign.statusCode);

    // 16. 员工自行修改所属部门
    const ownDept = await app.inject({
      method: "PUT", url: "/api/profile/department",
      headers: { cookie: emp2.cookie, "x-csrf-token": emp2.csrfToken },
      payload: { departmentId: "dep-1" }
    });
    record("员工自选所属部门", `${ownDept.statusCode} ${ownDept.json<{ code?: string }>().code ?? ""}`);

    // 17. 停用/删除保护与在线会话
    const selfDisable = await app.inject({
      method: "PATCH", url: "/api/admin/users/admin-1/status",
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken }, payload: { accountStatus: "DISABLED" }
    });
    record("管理员停用自己", `${selfDisable.statusCode} ${selfDisable.json<{ code?: string }>().code ?? ""}`);
    const disableHr = await app.inject({
      method: "PATCH", url: "/api/admin/users/hr-1/status",
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken }, payload: { accountStatus: "DISABLED" }
    });
    record("停用人事账号", disableHr.statusCode);
    const hrMeAfterDisable = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: hr.cookie } });
    record("被停用账号的在线会话", `${hrMeAfterDisable.statusCode} ${hrMeAfterDisable.json<{ code?: string }>().code ?? ""}`);

    // 18. 重置密码吊销会话
    const beforeReset = await login(app, "employee2", "User-password-42");
    const reset = await app.inject({
      method: "POST", url: "/api/admin/users/emp-2/reset-password",
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken }, payload: { initialPassword: "Reset-pass-42" }
    });
    record("管理员重置密码", reset.statusCode);
    const afterReset = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: beforeReset.cookie } });
    record("重置后旧会话", `${afterReset.statusCode} ${afterReset.json<{ code?: string }>().code ?? ""}`);

    // 19. 退出登录后会话失效
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: mgmt.cookie, "x-csrf-token": mgmt.csrfToken } });
    record("退出登录", logout.statusCode);
    const afterLogout = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: mgmt.cookie } });
    record("退出后复用 Cookie", `${afterLogout.statusCode} ${afterLogout.json<{ code?: string }>().code ?? ""}`);

    // 20. 离职只读
    const departed = authRepository.users.get("leader-1")!;
    (departed as { employmentStatus?: string }).employmentStatus = "DEPARTED";
    const departedWrite = await app.inject({
      method: "POST", url: "/api/logs/drafts", headers: { cookie: leader1.cookie, "x-csrf-token": leader1.csrfToken },
      payload: { workDate: "2026-10-10", items: validItems }
    });
    record("离职后写操作", `${departedWrite.statusCode} ${departedWrite.json<{ code?: string }>().code ?? ""}`);
    const departedRead = await app.inject({ method: "GET", url: "/api/logs/mine", headers: { cookie: leader1.cookie } });
    record("离职后读本人日志", departedRead.statusCode);

    // 21. 超长/畸形输入
    const longPassword = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "employee1", password: "x".repeat(300) } });
    record("登录密码 300 字符", longPassword.statusCode);
    const longUsernameLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "x".repeat(100), password: "abc" } });
    record("登录用户名 100 字符", longUsernameLogin.statusCode);
    const protoPayload = await app.inject({
      method: "POST", url: "/api/admin/users", headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      payload: { username: "proto01", displayName: "污染", initialPassword: "Proto-pass-42", role: "EMPLOYEE", __proto__: { role: "ADMIN" } }
    });
    record("原型污染字段", `${protoPayload.statusCode} ${String(protoPayload.json<{ user?: { role?: string } }>().user?.role ?? "")}`);

    // 22. 搜索注入样载荷
    const injection = await app.inject({ method: "GET", url: "/api/logs?search=%27%20OR%201%3D1--", headers: { cookie: emp1.cookie } });
    record("日志搜索注入载荷", `${injection.statusCode} total=${String(injection.json<{ total?: number }>().total ?? "")}`);

    // 23. 提醒越权读取他人
    const otherReminder = await app.inject({ method: "POST", url: "/api/reminders/fake-id/read", headers: { cookie: emp2.cookie, "x-csrf-token": emp2.csrfToken } });
    record("标记不存在提醒已读", otherReminder.statusCode);

    // 24. 健康检查与非 API 路径
    const notFoundApi = await app.inject({ method: "GET", url: "/api/nope" });
    record("未知 API 路径", `${notFoundApi.statusCode} ${notFoundApi.json<{ code?: string }>().code ?? ""}`);
    const health = await app.inject({ method: "GET", url: "/api/health" });
    record("健康检查", health.statusCode);

    // 25. 锁定到期后失败计数是否清零：置为 15 分钟前锁定、计数 5
    const locked = authRepository.users.get("emp-1")!;
    locked.failedLoginCount = 5;
    locked.lockedUntil = new Date(NOW.getTime() - 60_000);
    const afterExpiry = await login(app, "employee1", "wrong-password");
    const relocked = authRepository.users.get("emp-1")!.lockedUntil;
    record("锁定到期后 1 次输错", `${afterExpiry.status} 再次锁定=${Boolean(relocked && relocked > NOW)} 剩余分钟=${relocked ? Math.round((relocked.getTime() - NOW.getTime()) / 60000) : 0}`);
    record("锁定到期后失败计数", authRepository.users.get("emp-1")!.failedLoginCount);

    console.log("\n===== QA RESULTS =====\n" + results.join("\n") + "\n======================\n");
    expect(results.length).toBeGreaterThan(20);
    await app.close();
  }, 120_000);

  it("登录耗时差异（用户名枚举时序侧信道）", async () => {
    const { app } = await setup();
    const measure = async (username: string) => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "wrong-password" } });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return samples[2]!.toFixed(1);
    };
    // 每次测量前重置失败计数，避免锁定分支干扰
    const existing = await measure("employee1");
    const ghost = await measure("ghost-user");
    console.log(`\n===== TIMING =====\n存在用户中位耗时: ${existing}ms\n不存在用户中位耗时: ${ghost}ms\n==================\n`);
    await app.close();
  }, 120_000);
});
