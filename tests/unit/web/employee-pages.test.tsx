// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ logs: [{
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
    }] }), { status: 200 }));
    render(<HistoryPage />);
    const itemOneComments = await screen.findByLabelText("事项 1 评注");
    expect(within(itemOneComments).getByText("批注 1")).toBeInTheDocument();
    expect(within(itemOneComments).queryByText("批注 2")).not.toBeInTheDocument();
    expect(within(itemOneComments).getByText(/李经理/)).toBeInTheDocument();
  });
});
