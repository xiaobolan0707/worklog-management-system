import { expect, test, type Page } from "@playwright/test";

test.skip(process.env["E2E_RUN"] !== "1", "需要已准备好的验收数据库和四类角色账号");

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
}

test("employee submits green, leader makes it red, and employee sees the result", async ({ page }) => {
  const employee = process.env["E2E_ACCEPTANCE_EMPLOYEE"]!;
  const employeePassword = process.env["E2E_ACCEPTANCE_EMPLOYEE_PASSWORD"]!;
  const leader = process.env["E2E_ACCEPTANCE_LEADER"]!;
  const leaderPassword = process.env["E2E_ACCEPTANCE_LEADER_PASSWORD"]!;
  test.skip(!employee || !employeePassword || !leader || !leaderPassword, "缺少验收账号环境变量");

  await login(page, employee, employeePassword);
  await page.getByLabel("工作内容 1").fill(`验收日志 ${Date.now()}`);
  await page.getByRole("button", { name: "提交日志" }).click();
  await expect(page.getByText("已提交", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();

  await login(page, leader, leaderPassword);
  await expect(page.getByText(/分数|评分/)).toHaveCount(0);
  await page.getByLabel("红色：已完成").first().check();
  await page.getByRole("button", { name: "确认核查" }).first().click();
  await page.getByRole("button", { name: "退出登录" }).click();

  await login(page, employee, employeePassword);
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
});

test("management and administrator see their complete consoles without numeric scoring", async ({ page }) => {
  const management = process.env["E2E_ACCEPTANCE_MANAGEMENT"]!;
  const managementPassword = process.env["E2E_ACCEPTANCE_MANAGEMENT_PASSWORD"]!;
  const admin = process.env["E2E_ACCEPTANCE_ADMIN"]!;
  const adminPassword = process.env["E2E_ACCEPTANCE_ADMIN_PASSWORD"]!;
  test.skip(!management || !managementPassword || !admin || !adminPassword, "缺少验收账号环境变量");

  await login(page, management, managementPassword);
  await expect(page.getByRole("link", { name: "公司总览" })).toBeVisible();
  await expect(page.getByRole("link", { name: "全部日志" })).toBeVisible();
  await expect(page.getByRole("link", { name: "奖惩确认" })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();

  await login(page, admin, adminPassword);
  for (const label of ["用户管理", "部门管理", "审批配置", "系统设置", "审计记录"]) {
    await expect(page.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(page.getByText(/分数|评分/)).toHaveCount(0);
});
