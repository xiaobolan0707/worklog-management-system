// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "../../../src/web/components/AppShell.js";
import { ChangeInitialPasswordPage } from "../../../src/web/pages/ChangeInitialPasswordPage.js";
import { LoginPage } from "../../../src/web/pages/LoginPage.js";

describe("authentication UI", () => {
  it("shows a safe login error", async () => {
    const user = userEvent.setup();
    render(
      <LoginPage
        onLogin={async () => {
          throw new Error("用户名或密码错误");
        }}
      />
    );
    await user.type(screen.getByLabelText("用户名"), "employee");
    await user.type(screen.getByLabelText("密码"), "wrong");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码错误");
  });

  it("forces initial password change with accessible fields", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChangeInitialPasswordPage onChange={onChange} />);
    await user.type(screen.getByLabelText("初始密码"), "Initial-password-42");
    await user.type(screen.getByLabelText("新密码"), "New-password-84");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    expect(onChange).toHaveBeenCalledWith("Initial-password-42", "New-password-84");
  });

  it("shows only employee navigation and supports logout", async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell
          user={{ id: "employee-1", username: "employee", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false }}
          onLogout={onLogout}
        >
          <p>工作台</p>
        </AppShell>
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "今日日志" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "用户管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "待审日志" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
