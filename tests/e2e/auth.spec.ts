import { expect, test } from "@playwright/test";

test.skip(process.env["E2E_RUN"] !== "1", "需要已准备好的验收数据库和账号");

test("new user changes the initial password and keeps the session after refresh", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名").fill(process.env["E2E_EMPLOYEE_USERNAME"] ?? "employee");
  await page.getByLabel("密码").fill(process.env["E2E_EMPLOYEE_PASSWORD"] ?? "Employee-password-42");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "首次登录，请设置新密码" })).toBeVisible();
  await page.getByLabel("初始密码").fill(process.env["E2E_EMPLOYEE_PASSWORD"] ?? "Employee-password-42");
  await page.getByLabel("新密码").fill("New-password-84");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await page.reload();
  await expect(page.getByRole("link", { name: "今日日志" })).toBeVisible();
});
