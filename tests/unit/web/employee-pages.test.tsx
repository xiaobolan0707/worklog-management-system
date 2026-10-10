// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayLogPage } from "../../../src/web/pages/employee/TodayLogPage.js";
import { WorkItemEditor } from "../../../src/web/components/logs/WorkItemEditor.js";
import { ApprovalProgress } from "../../../src/web/components/logs/ApprovalProgress.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("employee worklog pages", () => {
  it("adds and removes numbered work items", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkItemEditor items={[{ content: "", completed: true }]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /添加工作项/ }));
    expect(onChange).toHaveBeenCalledWith([
      { content: "", completed: true },
      { content: "", completed: true }
    ]);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("requires unfinished reasons and submits a persisted green log", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ logs: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ log: { id: "log-1", status: "DRAFT", color: null, items: [] } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ log: { id: "log-1", status: "SUBMITTED", color: "GREEN", items: [] } }), { status: 200 }));
    const user = userEvent.setup();
    render(<TodayLogPage />);
    await screen.findByRole("heading", { name: "今日工作日志" });
    await user.type(screen.getByLabelText("工作内容 1"), "进行项目联调");
    await user.selectOptions(screen.getByLabelText("完成状态 1"), "false");
    await user.click(screen.getByRole("button", { name: "提交日志" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写未完成原因");
    await user.type(screen.getByLabelText("未完成原因 1"), "等待测试环境");
    await user.click(screen.getByRole("button", { name: "提交日志" }));
    expect(await screen.findByText("已提交")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows approval comments and progress without any score", () => {
    render(<ApprovalProgress steps={[
      { approverId: "leader-1", position: 1, status: "APPROVED", color: "RED", comment: "已完成" },
      { approverId: "leader-2", position: 2, status: "PENDING", color: null, comment: null }
    ]} />);
    expect(screen.getAllByText("已完成")).not.toHaveLength(0);
    expect(screen.getByText("第 2 级审批")).toBeInTheDocument();
    expect(screen.queryByText(/score|分数|评分/i)).not.toBeInTheDocument();
  });
});
