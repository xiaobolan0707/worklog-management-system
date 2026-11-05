// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DepartmentsPage } from "../../../src/web/pages/admin/DepartmentsPage.js";

interface Employee { id: string; username: string; displayName: string; departmentId: string; accountStatus: string }
let departments: { id: string; name: string }[];
let employees: Employee[];
let rejectRename: boolean;
let profileDepartmentId: string;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  departments = [{ id: "a", name: "技术部" }, { id: "b", name: "内容部" }];
  employees = [{ id: "e1", username: "zhang", displayName: "张三", departmentId: "a", accountStatus: "ACTIVE" }];
  profileDepartmentId = "a";
  rejectRename = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === "/api/departments" || url === "/api/admin/departments" || url === "/api/profile/departments") return json({ departments });
    if (url === "/api/profile") return json({ user: { ...employees[0], departmentId: profileDepartmentId } });
    if (url === "/api/archives/e1") return json({ archive: { ...employees[0], username: "zhang", gender: "MALE", departmentName: "技术部", employeeNumberDisplay: "技术部 0001", numberDepartmentName: "技术部", employmentStatus: "ACTIVE", canEdit: true, completionDeadline: "2026-11-11T01:00:00Z", complete: false, missing: ["RESUME"], attachments: [] } });
    if (url === "/api/profile/department" && init?.method === "PUT") {
      profileDepartmentId = body.departmentId;
      return json({ user: { ...employees[0], departmentId: profileDepartmentId } });
    }
    if (url === "/api/admin/departments/a" && init?.method === "PATCH") {
      if (rejectRename) return json({ code: "DEPARTMENT_EXISTS", message: "部门名称已存在，请使用其他名称" }, 409);
      departments = departments.map((department) => department.id === "a" ? { ...department, name: body.name } : department);
      return json({ department: departments[0] });
    }
    if (url === "/api/admin/departments/a/number-prefix" && init?.method === "PATCH") return json({ department: { ...departments[0], employeeNumberPrefix: body.prefix } });
    const match = url.match(/^\/api\/departments\/([^/]+)\/employees(?:\/([^/]+))?$/);
    if (match) {
      if (init?.method === "POST") {
        const user = { id: "e2", username: body.username, displayName: body.displayName, departmentId: match[1]!, accountStatus: "ACTIVE" };
        employees.push(user);
        return json({ user }, 201);
      }
      if (init?.method === "PATCH") {
        const user = { ...employees.find((employee) => employee.id === match[2])!, ...body };
        employees = employees.map((employee) => employee.id === user.id ? user : employee);
        return json({ user });
      }
      return json({ employees: employees.filter((employee) => employee.departmentId === match[1]) });
    }
    return json({ message: "未实现的测试请求" }, 404);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("department and employee screens", () => {
  it("lets administrators configure an optional department number prefix", async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage role="ADMIN" />);
    await screen.findByText("张三");
    await user.click(screen.getByRole("button", { name: "设置工号标识" }));
    const input = screen.getByLabelText("部门工号标识（可留空）");
    expect(input).toHaveAttribute("maxlength", "20");
    await user.type(input, "JS");
    await user.click(screen.getByRole("button", { name: "保存工号标识" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/departments/a/number-prefix", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ prefix: "JS" }) })));
    await user.click(screen.getByRole("button", { name: "设置工号标识" }));
    await user.clear(screen.getByLabelText("部门工号标识（可留空）"));
    await user.click(screen.getByRole("button", { name: "保存工号标识" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/departments/a/number-prefix", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ prefix: null }) })));
  });
  it("lets administrators rename departments while preserving the visible employee hierarchy", async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage role="ADMIN" />);
    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.queryByText("e1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑部门名称" }));
    await user.clear(screen.getByLabelText("新部门名称"));
    await user.type(screen.getByLabelText("新部门名称"), "技术研发部");
    await user.click(screen.getByRole("button", { name: "保存部门名称" }));
    expect(await screen.findByRole("heading", { name: "技术研发部" })).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("部门名称已更新");
  });

  it("shows a duplicate-name error and keeps the rename form available", async () => {
    rejectRename = true;
    const user = userEvent.setup();
    render(<DepartmentsPage role="ADMIN" />);
    await screen.findByText("张三");
    await user.click(screen.getByRole("button", { name: "编辑部门名称" }));
    await user.clear(screen.getByLabelText("新部门名称"));
    await user.type(screen.getByLabelText("新部门名称"), "内容部");
    await user.click(screen.getByRole("button", { name: "保存部门名称" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("部门名称已存在");
    expect(screen.getByLabelText("新部门名称")).toHaveValue("内容部");
    expect(screen.getByRole("heading", { name: "技术部" })).toBeInTheDocument();
  });

  it("adds an employee inside the selected department without exposing role controls", async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage role="MANAGEMENT" />);
    await screen.findByText("张三");
    expect(screen.queryByRole("button", { name: "编辑部门名称" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加员工" }));
    await user.type(screen.getByLabelText("员工姓名"), "李四");
    await user.type(screen.getByLabelText("用户名（登录账号）"), "lisi");
    await user.type(screen.getByLabelText("初始密码"), "Employee-42");
    expect(screen.queryByLabelText("角色")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建员工" }));
    expect(await screen.findByText("李四")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("员工已添加");
  });

  it("moves an employee to the target department and refreshes both department views", async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage role="ADMIN" />);
    await screen.findByText("张三");
    await user.click(screen.getByRole("button", { name: "修改张三" }));
    await user.clear(screen.getByLabelText("员工姓名"));
    await user.type(screen.getByLabelText("员工姓名"), "张三新姓名");
    await user.selectOptions(screen.getByLabelText("所属部门"), "b");
    await user.click(screen.getByRole("button", { name: "保存员工信息" }));
    await waitFor(() => expect(screen.queryByText("张三新姓名")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "内容部" }));
    expect(await screen.findByText("张三新姓名")).toBeInTheDocument();
  });

  it("lets employees save their selected department from their own profile", async () => {
    const { EmployeeProfilePage } = await import("../../../src/web/pages/employee/EmployeeProfilePage.js");
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    const select = await screen.findByLabelText("所属部门");
    await user.selectOptions(select, "b");
    await user.click(screen.getByRole("button", { name: "保存部门归属" }));
    expect(await screen.findByRole("status")).toHaveTextContent("内容部");
    expect(screen.getByLabelText("所属部门")).toHaveValue("b");
    expect(profileDepartmentId).toBe("b");
  });
});
