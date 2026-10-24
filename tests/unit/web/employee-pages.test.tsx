// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayLogPage } from "../../../src/web/pages/employee/TodayLogPage.js";
import { WorkItemEditor, type EditableWorkItem } from "../../../src/web/components/logs/WorkItemEditor.js";
import { ApprovalProgress } from "../../../src/web/components/logs/ApprovalProgress.js";
import { AuthProvider } from "../../../src/web/auth/AuthProvider.js";
import { HistoryPage } from "../../../src/web/pages/employee/HistoryPage.js";
import { LogDetailPage } from "../../../src/web/pages/leader/LogDetailPage.js";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const emptyItems = () => [1, 2, 3, 4].map(() => ({ content: "", completed: true, images: [] }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("employee worklog pages", () => {
  it("does not show another employee's local draft on a shared browser", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    localStorage.setItem(`worklog:today-draft:${today}`, JSON.stringify([
      { content: "甲员工的私密工作内容", completed: true, images: [] }
    ]));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({
        user: { id: "employee-b", username: "employee-b", displayName: "乙员工", role: "EMPLOYEE", mustChangePassword: false }
      }), { status: 200 });
      if (url.includes("/api/logs/mine")) return new Response(JSON.stringify({ logs: [] }), { status: 200 });
      return new Response(null, { status: 404 });
    });
    render(<AuthProvider><TodayLogPage /></AuthProvider>);
    await screen.findByText("员工姓名：乙员工");
    expect(screen.getByLabelText("工作内容 1")).toHaveValue("");
  });

  it("starts with four numbered rows and never offers deletion below four", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkItemEditor items={emptyItems()} onChange={onChange} employeeName="张三" workDate="2026-10-12" />);
    expect(screen.getAllByLabelText(/工作内容/)).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /删除工作项/ })).not.toBeInTheDocument();
    expect(screen.queryByText("完成情况")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/完成状态/)).not.toBeInTheDocument();
    expect(screen.getByText("员工姓名：张三")).toBeInTheDocument();
    expect(screen.getByText("日志日期：2026-10-12")).toBeInTheDocument();
    expect(screen.getAllByText("0 / 最少 20 字")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: /添加工作项/ }));
    expect(onChange).toHaveBeenCalledWith([...emptyItems(), { content: "", completed: true, images: [] }]);
  });

  it("previews a supported image inside its work item", async () => {
    function Harness() {
      const [items, setItems] = useState<EditableWorkItem[]>(emptyItems());
      return <WorkItemEditor items={items} onChange={setItems} employeeName="张三" workDate="2026-10-12" />;
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText("上传图片 1"), new File(["abc"], "现场.png", { type: "image/png" }));
    expect(await screen.findByRole("img", { name: "现场.png" })).toBeInTheDocument();
  });

  it("pastes a clipboard image directly into the focused work item preview", async () => {
    function Harness() {
      const [items, setItems] = useState<EditableWorkItem[]>(emptyItems());
      return <WorkItemEditor items={items} onChange={setItems} employeeName="张三" workDate="2026-10-12" />;
    }
    render(<Harness />);
    const image = new File(["abc"], "截图.png", { type: "image/png" });
    const input = screen.getByLabelText("工作内容 2");
    fireEvent.paste(input, {
      clipboardData: { items: [{ kind: "file", getAsFile: () => image }] }
    });
    expect(await screen.findByRole("img", { name: "截图.png" })).toBeInTheDocument();
    expect(screen.queryByLabelText("工作内容 1")?.closest(".letter-row")?.querySelector("img")).toBeNull();
  });

  it("moves an image earlier within the same work item", async () => {
    const onChange = vi.fn();
    const items: EditableWorkItem[] = [
      { content: "现场", completed: true, images: [
        { id: "a", name: "A.png", type: "image/png", size: 1, dataUrl: "data:image/png;base64,YQ==" },
        { id: "b", name: "B.png", type: "image/png", size: 1, dataUrl: "data:image/png;base64,Yg==" }
      ] },
      ...emptyItems().slice(1)
    ];
    const user = userEvent.setup();
    render(<WorkItemEditor items={items} onChange={onChange} employeeName="张三" workDate="2026-10-12" />);
    await user.click(screen.getByRole("button", { name: "上移图片 B.png" }));
    expect(onChange.mock.calls.at(-1)?.[0][0].images.map((image: { name: string }) => image.name)).toEqual(["B.png", "A.png"]);
  });

  it("submits four employee work items without employee completion fields", async () => {
    const draftItems = [
      { content: "今天进行项目接口联调并完成全部异常情况验证工作", completed: true, images: [] },
      { content: "今天整理项目测试数据并完成全部结果检查确认工作", completed: true, images: [] },
      { content: "今天更新项目交付文档并补充所有必要操作说明", completed: true, images: [] },
      { content: "今天检查生产部署流程并确认各项服务运行正常", completed: true, images: [] }
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { id: "employee-1", username: "zhangsan", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false } }), { status: 200 });
      if (url.includes("/api/logs/mine")) return new Response(JSON.stringify({ logs: [] }), { status: 200 });
      if (url.endsWith("/submit")) return new Response(JSON.stringify({ log: { id: "log-1", employeeName: "张三", workDate: "2026-10-12", status: "SUBMITTED", color: "GREEN", items: draftItems } }), { status: 200 });
      if (url.endsWith("/api/logs/drafts") && init?.method === "POST") return new Response(JSON.stringify({ log: { id: "log-1", employeeName: "张三", workDate: "2026-10-12", status: "DRAFT", color: null, items: draftItems } }), { status: 201 });
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    render(<AuthProvider><TodayLogPage /></AuthProvider>);
    await screen.findByRole("heading", { name: "今日工作日志" });
    expect(await screen.findByText("员工姓名：张三")).toBeInTheDocument();
    await user.type(screen.getByLabelText("工作内容 1"), "内容不足二十字");
    await user.click(screen.getByRole("button", { name: "提交日志" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("第 1 项工作内容至少需要填写 20 字");
    await user.clear(screen.getByLabelText("工作内容 1"));
    for (const [index, item] of draftItems.entries()) {
      await user.type(screen.getByLabelText(`工作内容 ${index + 1}`), item.content);
    }
    await user.click(screen.getByRole("button", { name: "提交日志" }));
    expect(await screen.findByText("已提交")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it("starts a fresh editable log when the latest log belongs to a previous day", async () => {
    const previousLog = {
      id: "log-yesterday",
      employeeName: "张三",
      workDate: "2026-10-11",
      status: "SUBMITTED",
      color: "GREEN",
      items: [1, 2, 3, 4].map((position) => ({ position, content: `昨日工作 ${position}`, completed: true, images: [] }))
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { id: "employee-1", username: "zhangsan", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false } }), { status: 200 });
      if (url.includes("/api/logs/mine")) return new Response(JSON.stringify({ logs: [previousLog] }), { status: 200 });
      return new Response(null, { status: 404 });
    });

    render(<AuthProvider><TodayLogPage /></AuthProvider>);

    expect(await screen.findByRole("button", { name: "提交日志" })).toBeInTheDocument();
    expect(screen.getByLabelText("工作内容 1")).toHaveValue("");
    expect(screen.queryByText("昨日工作 1")).not.toBeInTheDocument();
  });

  it("shows today by default and scrolls through only the latest seven work plans", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T04:00:00.000Z"));
    const logs = [
      { workDate: "2026-10-09", planTarget: "范围外计划", planDueAt: "2026-10-09T10:00:00.000Z" },
      { workDate: "2026-10-15", planTarget: "昨日计划", planDueAt: "2026-10-15T10:00:00.000Z" },
      { workDate: "2026-10-16", planTarget: "今日计划", planDueAt: "2026-10-16T10:00:00.000Z" }
    ].map((plan, index) => ({
      id: `log-${index}`,
      employeeName: "张三",
      status: "SUBMITTED",
      color: "GREEN",
      items: emptyItems(),
      ...plan
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { id: "employee-1", username: "zhangsan", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false } }), { status: 200 });
      if (url.includes("/api/logs/mine")) return new Response(JSON.stringify({ logs }), { status: 200 });
      if (url.endsWith("/api/logs/log-2")) return new Response(JSON.stringify({ log: logs[2] }), { status: 200 });
      return new Response(null, { status: 404 });
    });

    render(<AuthProvider><TodayLogPage /></AuthProvider>);

    const plans = await screen.findByRole("region", { name: "最近 7 天工作计划" });
    expect(within(plans).getByText("2026-10-16")).toBeInTheDocument();
    expect(await within(plans).findByText("今日计划")).toBeInTheDocument();
    expect(within(plans).queryByText("范围外计划")).not.toBeInTheDocument();

    const previousEvent = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    fireEvent(plans, previousEvent);
    expect(previousEvent.defaultPrevented).toBe(true);
    expect(within(plans).getByText("昨日计划")).toBeInTheDocument();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      within(plans).getByRole("button", { name: "查看今天" })
    );
    const endEvent = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    fireEvent(plans, endEvent);
    expect(endEvent.defaultPrevented).toBe(false);
  });

  it("saves today's work plan with the log draft", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T04:00:00.000Z"));
    const requests: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { id: "employee-1", username: "zhangsan", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false } }), { status: 200 });
      if (url.includes("/api/logs/mine")) return new Response(JSON.stringify({ logs: [] }), { status: 200 });
      if (url.endsWith("/api/logs/drafts")) {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ log: { id: "log-1", employeeName: "张三", workDate: "2026-10-16", status: "DRAFT", color: null, items: emptyItems(), planTarget: "完成周报", planDueAt: "2026-10-16T10:00:00.000Z" } }), { status: 201 });
      }
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    render(<AuthProvider><TodayLogPage /></AuthProvider>);

    expect(await screen.findByText("当日暂无工作计划")).toBeInTheDocument();
    await user.type(await screen.findByLabelText("工作计划"), "完成周报");
    await user.type(screen.getByLabelText("计划完成时间"), "2026-10-16T18:00");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(requests).toContainEqual(expect.objectContaining({
      planTarget: "完成周报",
      planDueAt: "2026-10-16T10:00:00.000Z"
    }));
  });

  it("does not reuse an undated browser draft on a later day", async () => {
    localStorage.setItem("worklog:today-draft", JSON.stringify([
      { content: "昨日未提交草稿", completed: true, images: [] },
      ...emptyItems().slice(1)
    ]));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { id: "employee-1", username: "zhangsan", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false } }), { status: 200 });
      if (url.includes("/api/logs/mine")) return new Response(JSON.stringify({ logs: [] }), { status: 200 });
      return new Response(null, { status: 404 });
    });

    render(<AuthProvider><TodayLogPage /></AuthProvider>);

    await screen.findByText("员工姓名：张三");
    expect(screen.getByLabelText("工作内容 1")).toHaveValue("");
  });

  it("shows approval comments and progress without any score", () => {
    render(<ApprovalProgress steps={[
      { approverId: "leader-1", approverName: "李经理", approverRole: "LEADER", position: 1, status: "APPROVED", color: "RED", comment: null, itemComments: [{ itemPosition: 1, comment: "已完成" }], actedAt: "2026-10-12T02:00:00.000Z" },
      { approverId: "leader-2", approverName: "王总", approverRole: "MANAGEMENT", position: 2, status: "PENDING", color: null, comment: null, itemComments: [], actedAt: null }
    ]} />);
    expect(screen.getAllByText("已完成")).not.toHaveLength(0);
    expect(screen.getByText("王总 · 管理层")).toBeInTheDocument();
    expect(screen.queryByText(/score|分数|评分/i)).not.toBeInTheDocument();
  });

  it("shows each submitted approver comment beside the matching item immediately", async () => {
    const log = {
      id: "log-1",
      employeeName: "张三",
      workDate: "2026-10-12",
      status: "IN_REVIEW",
      color: "RED",
      items: [1, 2, 3, 4].map((position) => ({ position, content: `工作事项 ${position}`, completed: position !== 1, unfinishedReason: position === 1 ? "员工旧状态" : undefined, images: [] })),
      approvalSteps: [{
        approverId: "leader-1",
        approverName: "李经理",
        approverRole: "LEADER",
        position: 1,
        status: "APPROVED",
        color: "RED",
        comment: null,
        itemComments: [1, 2, 3, 4].map((itemPosition) => ({ itemPosition, comment: `批注 ${itemPosition}` })),
        actedAt: "2026-10-12T02:00:00.000Z"
      }]
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/logs/mine")) return new Response(JSON.stringify({ logs: [{ id: log.id, workDate: log.workDate, status: log.status, color: log.color }], total: 1 }), { status: 200 });
      if (url.endsWith("/api/logs/log-1")) return new Response(JSON.stringify({ log }), { status: 200 });
      return new Response(null, { status: 404 });
    });
    render(<MemoryRouter initialEntries={["/employee/history"]}><Routes>
      <Route path="/employee/history" element={<HistoryPage />} />
      <Route path="/employee/logs/:id" element={<LogDetailPage backTo="/employee/history" />} />
    </Routes></MemoryRouter>);
    await userEvent.setup().click(await screen.findByRole("link", { name: "查看完整日志与批注" }));
    await screen.findByText("工作事项 1");
    const itemOneComments = await screen.findByLabelText("事项 1 评注");
    expect(await within(itemOneComments).findByText("批注 1")).toBeInTheDocument();
    expect(within(itemOneComments).queryByText("批注 2")).not.toBeInTheDocument();
    expect(within(itemOneComments).getByText(/李经理/)).toBeInTheDocument();
    expect(screen.queryByText("未完成：员工旧状态")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets an employee reply below a specific comment and shows the saved reply", async () => {
    const log = {
      id: "log-1", employeeName: "张三", workDate: "2026-10-12", color: "RED",
      items: [{ position: 1, content: "工作事项 1", completed: true, images: [] }],
      approvalSteps: [{
        id: "step-1", approverId: "leader-1", approverName: "李经理", approverRole: "LEADER",
        position: 1, status: "APPROVED", color: "RED", comment: null,
        itemComments: [{ itemPosition: 1, comment: "请补充测试结果" }],
        replies: [] as { id: string; itemPosition: number; content: string; createdAt: string }[],
        actedAt: "2026-10-12T02:00:00.000Z"
      }]
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        log.approvalSteps[0]!.replies.push({ id: "reply-1", itemPosition: 1, content: "已补充，测试通过。", createdAt: "2026-10-12T03:00:00.000Z" });
      }
      return new Response(JSON.stringify({ log }), { status: 200 });
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/employee/logs/log-1"]}>
      <Routes><Route path="/employee/logs/:id" element={<LogDetailPage backTo="/employee/history" />} /></Routes>
    </MemoryRouter>);
    await user.type(await screen.findByRole("textbox", { name: /回复第 1 项/ }), "已补充，测试通过。");
    await user.click(screen.getByRole("button", { name: "发送回复" }));
    expect(await screen.findByText("已补充，测试通过。")).toBeInTheDocument();
    expect(screen.getByText("回复已发送")).toBeInTheDocument();
    cleanup();
    render(<MemoryRouter initialEntries={["/leader/logs/log-1"]}>
      <Routes><Route path="/leader/logs/:id" element={<LogDetailPage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText("已补充，测试通过。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送回复" })).not.toBeInTheDocument();
  });

  it("keeps replies to a returned submission beside the original work item", async () => {
    const log = {
      id: "log-1", employeeName: "张三", workDate: "2026-10-12", color: "RED", submissionCount: 2,
      items: [{ position: 1, content: "重新安排后的工作", completed: true, images: [] }],
      versions: [
        [{ position: 1, content: "原来的接口测试", completed: true, images: [] }],
        [{ position: 1, content: "重新安排后的工作", completed: true, images: [] }]
      ],
      approvalSteps: [{
        id: "old-step", submissionNumber: 1, approverId: "leader-1", approverName: "李经理",
        approverRole: "LEADER", position: 1, status: "RETURNED", color: null, comment: null,
        itemComments: [{ itemPosition: 1, comment: "请核对接口测试" }],
        replies: [{ id: "reply-1", itemPosition: 1, content: "已核对原接口", createdAt: "2026-10-12T03:00:00.000Z" }],
        actedAt: "2026-10-12T02:00:00.000Z"
      }]
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ log }), { status: 200 }));
    render(<MemoryRouter initialEntries={["/employee/logs/log-1"]}>
      <Routes><Route path="/employee/logs/:id" element={<LogDetailPage backTo="/employee/history" />} /></Routes>
    </MemoryRouter>);
    const currentItemComments = await screen.findByLabelText("事项 1 评注");
    expect(within(currentItemComments).queryByText("请核对接口测试")).not.toBeInTheDocument();
    const history = screen.getByRole("region", { name: "第 1 次提交的批注与回复" });
    expect(within(history).getByText("原来的接口测试")).toBeInTheDocument();
    expect(within(history).getByText("请核对接口测试")).toBeInTheDocument();
    expect(within(history).getByText("已核对原接口")).toBeInTheDocument();
  });
});
