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

const emptyItems = () => [1, 2, 3, 4].map(() => ({ content: "", completed: true, images: [] }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("employee worklog pages", () => {
  it("starts with four numbered rows and never offers deletion below four", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkItemEditor items={emptyItems()} onChange={onChange} employeeName="张三" workDate="2026-10-12" />);
    expect(screen.getAllByLabelText(/工作内容/)).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /删除工作项/ })).not.toBeInTheDocument();
    expect(screen.getByText("员工姓名：张三")).toBeInTheDocument();
    expect(screen.getByText("日志日期：2026-10-12")).toBeInTheDocument();
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

  it("requires unfinished reasons and submits a persisted green log", async () => {
    const draftItems = [
      { content: "进行项目联调", completed: false, unfinishedReason: "等待测试环境", images: [] },
      { content: "整理数据", completed: true, images: [] },
      { content: "更新文档", completed: true, images: [] },
      { content: "检查部署", completed: true, images: [] }
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { id: "employee-1", username: "zhangsan", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false } }), { status: 200 });
      if (url.endsWith("/api/logs/mine")) return new Response(JSON.stringify({ logs: [] }), { status: 200 });
      if (url.endsWith("/submit")) return new Response(JSON.stringify({ log: { id: "log-1", employeeName: "张三", workDate: "2026-10-12", status: "SUBMITTED", color: "GREEN", items: draftItems } }), { status: 200 });
      if (url.endsWith("/api/logs/drafts") && init?.method === "POST") return new Response(JSON.stringify({ log: { id: "log-1", employeeName: "张三", workDate: "2026-10-12", status: "DRAFT", color: null, items: draftItems } }), { status: 201 });
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    render(<AuthProvider><TodayLogPage /></AuthProvider>);
    await screen.findByRole("heading", { name: "今日工作日志" });
    expect(await screen.findByText("员工姓名：张三")).toBeInTheDocument();
    await user.type(screen.getByLabelText("工作内容 1"), "进行项目联调");
    await user.selectOptions(screen.getByLabelText("完成状态 1"), "false");
    await user.click(screen.getByRole("button", { name: "提交日志" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写第 2 项工作内容或图片");
    await user.type(screen.getByLabelText("工作内容 2"), "整理数据");
    await user.type(screen.getByLabelText("工作内容 3"), "更新文档");
    await user.type(screen.getByLabelText("工作内容 4"), "检查部署");
    await user.click(screen.getByRole("button", { name: "提交日志" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写未完成原因");
    await user.type(screen.getByLabelText("未完成原因 1"), "等待测试环境");
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
      if (url.endsWith("/api/logs/mine")) return new Response(JSON.stringify({ logs: [previousLog] }), { status: 200 });
      return new Response(null, { status: 404 });
    });

    render(<AuthProvider><TodayLogPage /></AuthProvider>);

    expect(await screen.findByRole("button", { name: "提交日志" })).toBeInTheDocument();
    expect(screen.getByLabelText("工作内容 1")).toHaveValue("");
    expect(screen.queryByText("昨日工作 1")).not.toBeInTheDocument();
  });

  it("does not reuse an undated browser draft on a later day", async () => {
    localStorage.setItem("worklog:today-draft", JSON.stringify([
      { content: "昨日未提交草稿", completed: true, images: [] },
      ...emptyItems().slice(1)
    ]));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { id: "employee-1", username: "zhangsan", displayName: "张三", role: "EMPLOYEE", mustChangePassword: false } }), { status: 200 });
      if (url.endsWith("/api/logs/mine")) return new Response(JSON.stringify({ logs: [] }), { status: 200 });
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
      items: [1, 2, 3, 4].map((position) => ({ position, content: `工作事项 ${position}`, completed: true, images: [] })),
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
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ logs: [{ ...log, approvalSteps: [] }] }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ logs: [log] }), { status: 200 }));
    render(<HistoryPage />);
    await screen.findByText("工作事项 1");
    fireEvent(window, new Event("focus"));
    const itemOneComments = await screen.findByLabelText("事项 1 评注");
    expect(await within(itemOneComments).findByText("批注 1")).toBeInTheDocument();
    expect(within(itemOneComments).queryByText("批注 2")).not.toBeInTheDocument();
    expect(within(itemOneComments).getByText(/李经理/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
