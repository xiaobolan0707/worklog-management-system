// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ArchivePanel } from "../../../src/web/pages/archives/ArchivePanel.js";
import { PersonnelPage } from "../../../src/web/pages/hr/PersonnelPage.js";
import { HrStatusPage, beijingRange } from "../../../src/web/pages/hr/StatusPage.js";
import { ExemptionsPage } from "../../../src/web/pages/hr/ExemptionsPage.js";
import { RecycleBinPage } from "../../../src/web/pages/management/RecycleBinPage.js";
import { AppRouter } from "../../../src/web/router.js";
import type { SessionUser } from "../../../src/web/api/client.js";

const auth = vi.hoisted(() => ({ user: { id: "hr", username: "hr", displayName: "人事专员", role: "HR", mustChangePassword: false } as SessionUser, loading: false, logout: vi.fn(), login: vi.fn(), changeInitialPassword: vi.fn() }));
vi.mock("../../../src/web/auth/AuthProvider.js", () => ({ useAuth: () => auth }));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const archive = { id: "e1", username: "zhang", displayName: "张三", gender: "MALE", departmentId: "d1", departmentName: "技术部", employeeNumberDisplay: "JS0001", numberDepartmentName: "技术部", hireDate: "2026-11-01", departureDate: null, employmentStatus: "ACTIVE", completionDeadline: "2026-11-11T01:00:00Z", complete: false, missing: ["DEGREE", "AGREEMENT"], canEdit: true, attachments: [{ id: "a1", category: "RESUME", name: "个人简历.pdf", size: 1024, mimeType: "application/pdf", createdAt: "2026-11-04" }] };
const personnel = { id: "e1", displayName: "张三", role: "LEADER", departmentId: "d1", departmentName: "技术部", employeeNumber: null, numberDepartmentId: null, hireDate: "2026-11-01", departureDate: null, employmentStatus: "ACTIVE" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); auth.user = { id: "hr", username: "hr", displayName: "人事专员", role: "HR", mustChangePassword: false }; });

describe("archives and dedicated HR UI", () => {
  it("saves only personal fields and uploads protected attachments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => init?.method ? json({}) : json({ archive }));
    const user = userEvent.setup(); render(<ArchivePanel employeeId="e1" />);
    await user.clear(await screen.findByLabelText("姓名")); await user.type(screen.getByLabelText("姓名"), "张三新"); await user.selectOptions(screen.getByRole("combobox", { name: "性别" }), "FEMALE");
    await user.click(screen.getByRole("button", { name: "保存基本信息" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/archives/e1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ displayName: "张三新", gender: "FEMALE" }) })));
    await user.upload(await screen.findByLabelText("上传学历证明"), new File(["%PDF-1.7"], "学历.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/archives/e1/attachments" && JSON.parse(String(init?.body)).category === "DEGREE")).toBe(true));
    expect(screen.getByRole("link", { name: "个人简历.pdf" })).toHaveAttribute("href", "/api/archives/e1/attachments/a1");
    expect(screen.queryByLabelText("入职日期")).not.toBeInTheDocument();
  });
  it("keeps departed archives read only even if a stale canEdit flag is true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ archive: { ...archive, employmentStatus: "DEPARTED" } }));
    render(<ArchivePanel employeeId="e1" />);
    expect(await screen.findByText("离职 · 只读")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存基本信息" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("上传简历")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除附件/ })).not.toBeInTheDocument();
  });
  it("handles an existing employee with no recorded gender without inventing a choice", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ archive: { ...archive, gender: null } }));
    render(<ArchivePanel employeeId="e1" />);
    expect(await screen.findByLabelText("性别")).toHaveValue("");
    expect(screen.getByLabelText("性别")).toBeRequired();
  });
  it("requires a named management successor for a departing leader", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => init?.method ? json({ employee: personnel }) : json({ employees: [personnel], departments: [{ id: "d1", name: "技术部", employeeNumberPrefix: "JS" }], managers: [{ id: "m1", displayName: "李总" }] }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup(); render(<PersonnelPage />);
    await user.click(await screen.findByRole("button", { name: "维护张三任职信息" }));
    expect(screen.getByRole("combobox", { name: "筛选部门" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "任职状态" }), "DEPARTED");
    expect(screen.getByLabelText("接手审批的管理层")).toBeRequired();
    await user.type(screen.getByLabelText("离职日期"), "2026-11-04"); await user.selectOptions(screen.getByLabelText("接手审批的管理层"), "m1");
    await user.click(screen.getByRole("button", { name: "保存任职信息" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/hr/personnel/e1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ hireDate: "2026-11-01", departureDate: "2026-11-04", employmentStatus: "DEPARTED", handoverManagerId: "m1" }) })));
  });
  it("uses Beijing calendar dates for week/month boundaries", () => {
    expect(beijingRange("week", new Date("2026-11-01T17:00:00Z"))).toEqual({ from: "2026-11-02", to: "2026-11-02" });
    expect(beijingRange("month", new Date("2026-10-31T17:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });
  it("exports the displayed filters and sends only metadata when reminding", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => init?.method ? json({ ok: true }) : json({ rows: [{ employeeId: "e1", displayName: "张三", departmentName: "技术部", workDate: "2026-11-02", expected: true, submissionStatus: "OVERDUE", approvalStatus: null, currentApproverName: null, approvalOverdue: false }], summary: { expected: 1, submitted: 0, finalApproved: 0, overduePeople: 1, submissionRate: 0, approvalCompletionRate: null }, employees: [{ id: "e1", displayName: "张三", departmentId: "d1" }], departments: [{ id: "d1", name: "技术部" }] }));
    const user = userEvent.setup(); render(<HrStatusPage />);
    const exportLink = await screen.findByRole("link", { name: "导出状态 CSV" });
    expect(exportLink.getAttribute("href")).toContain("/api/hr/status/export?from=");
    expect(screen.queryByRole("link", { name: /完整日志/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "催交张三2026-11-02" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/hr/reminders", expect.objectContaining({ method: "POST", body: JSON.stringify({ employeeId: "e1", workDate: "2026-11-02", kind: "SUBMISSION" }) })));
  });
  it("retains all filter options while loading and after the backend returns a filtered employee list", async () => {
    const employees = [{ id: "e1", displayName: "张三", departmentId: "d1" }, { id: "e2", displayName: "李四", departmentId: "d2" }];
    const result = { rows: [], summary: { expected: 0, submitted: 0, finalApproved: 0, overduePeople: 0, submissionRate: null, approvalCompletionRate: null }, employees, departments: [{ id: "d1", name: "技术部" }, { id: "d2", name: "内容部" }] };
    let finish!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(result)).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); render(<HrStatusPage />);
    await screen.findByRole("option", { name: "李四" });
    expect(screen.getByRole("combobox", { name: "日期范围" })).toBeInTheDocument();
    const departmentSelect = screen.getByRole("combobox", { name: "部门" });
    const employeeSelect = screen.getByRole("combobox", { name: "员工" });
    await user.selectOptions(departmentSelect, "d1"); await user.selectOptions(employeeSelect, "e1");
    await user.click(screen.getByRole("button", { name: "查询台账" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(departmentSelect).getByRole("option", { name: "内容部" })).toBeInTheDocument();
    expect(employeeSelect).toHaveValue("e1");
    finish(json({ ...result, employees: [employees[0]] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "查询台账" })).toBeEnabled());
    await user.selectOptions(departmentSelect, "");
    expect(within(employeeSelect).getByRole("option", { name: "李四" })).toBeInTheDocument();
    await user.selectOptions(employeeSelect, "e2");
    expect(employeeSelect).toHaveValue("e2");
  });
  it("persists exemption days independently of system settings", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ weekdays: [0], dates: ["2026-11-03"] }));
    const user = userEvent.setup(); render(<ExemptionsPage />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "周日" })).toBeChecked());
    await user.click(screen.getByRole("checkbox", { name: "周六" })); await user.click(screen.getByRole("button", { name: "保存免交日" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/hr/exemptions", expect.objectContaining({ method: "PUT", body: JSON.stringify({ weekdays: [0, 6], dates: ["2026-11-03"] }) })));
  });
  it("requires confirmation for permanent deletion and explains restoration", async () => {
    const employee = { id: "e1", displayName: "张三", departmentName: "技术部", recycledAt: "2026-11-01", purgeAt: "2026-12-01", archivePurgingAt: null };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ employees: [employee] }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup(); render(<RecycleBinPage />);
    await user.click(await screen.findByRole("button", { name: "彻底删除" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    confirm.mockReturnValue(true); await user.click(screen.getByRole("button", { name: "彻底删除" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/recycle-bin/e1", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirm: true }) })));
  });
  it.each(["/employee/today", "/employee/profile", "/employee/backfill", "/employee/history", "/employee/logs/secret", "/employee/stats", "/leader/approvals", "/leader/logs/secret", "/management", "/management/recycle-bin", "/archives", "/archives/e1", "/departments", "/admin/users", "/admin/audit"])("redirects HR from %s before issuing a content request", async (path) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/reminders" ? json({ reminders: [] }) : String(input) === "/api/hr/personnel" ? json({ employees: [], departments: [], managers: [] }) : json({}, 403));
    render(<MemoryRouter initialEntries={[path]}><AppRouter /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "人员管理" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([url]) => ["/api/reminders", "/api/hr/personnel"].includes(String(url)))).toBe(true);
    const nav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(nav).getAllByRole("link")).toHaveLength(3);
    expect(within(nav).queryByRole("link", { name: "我的档案" })).not.toBeInTheDocument();
  });
  it("routes departed leaders to their own read-only archive with only historical navigation", async () => {
    auth.user = { id: "e1", username: "zhang", displayName: "张三", role: "LEADER", employmentStatus: "DEPARTED", mustChangePassword: false };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/reminders" ? json({ reminders: [] }) : String(input) === "/api/profile" ? json({ user: { id: "e1", username: "zhang", displayName: "张三", departmentId: "d1" } }) : String(input) === "/api/archives/e1" ? json({ archive: { ...archive, employmentStatus: "DEPARTED", canEdit: false } }) : json({}, 403));
    render(<MemoryRouter initialEntries={["/leader/approvals"]}><AppRouter /></MemoryRouter>);
    expect(await screen.findByText("离职 · 只读")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存部门归属" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getAllByRole("link")).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/approvals"))).toBe(false);
  });
  it("preserves administrator access to the existing business log route", async () => {
    auth.user = { id: "admin", username: "admin", displayName: "管理员", role: "ADMIN", mustChangePassword: false };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/reminders" ? json({ reminders: [] }) : String(input).startsWith("/api/logs?") ? json({ logs: [], total: 0 }) : json({}, 403));
    render(<MemoryRouter initialEntries={["/leader/logs"]}><AppRouter /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "日志查询" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/logs?"))).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/admin/users")).toBe(false);
  });
});
