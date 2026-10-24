// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../../../src/web/components/AppShell.js";
import { ChangeInitialPasswordPage } from "../../../src/web/pages/ChangeInitialPasswordPage.js";
import { LoginPage } from "../../../src/web/pages/LoginPage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("authentication UI", () => {
  it("lets an employee register from the login page", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/auth/register") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    render(<LoginPage onLogin={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "员工注册" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("minlength", "6");
    expect(screen.getByLabelText("确认密码")).toHaveAttribute("minlength", "6");
    await user.type(screen.getByLabelText("姓名"), "新员工");
    await user.type(screen.getByLabelText("用户名"), "new.employee");
    await user.type(screen.getByLabelText("密码"), "123456");
    await user.type(screen.getByLabelText("确认密码"), "123456");
    await user.click(screen.getByRole("button", { name: "提交注册" }));

    expect(await screen.findByText("注册成功，请等待管理员启用账号。" )).toBeInTheDocument();
  });

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
    expect(screen.getByLabelText("新密码")).toHaveAttribute("minlength", "6");
    expect(screen.getByText("新密码至少 6 位，保存后即可进入工作台。")).toBeInTheDocument();
    await user.type(screen.getByLabelText("初始密码"), "Initial-password-42");
    await user.type(screen.getByLabelText("新密码"), "654321");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    expect(onChange).toHaveBeenCalledWith("Initial-password-42", "654321");
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
