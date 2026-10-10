// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalPage } from "../../../src/web/pages/leader/ApprovalPage.js";
import { ApproversPage } from "../../../src/web/pages/admin/ApproversPage.js";
import { SettingsPage } from "../../../src/web/pages/admin/SettingsPage.js";

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("leader and administrator pages",()=>{
  it("offers only red or gray approval and never renders a score",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({logs:[{id:"log-1",employeeId:"employee-1",workDate:"2026-10-10",items:[{position:1,content:"完成接口"}]}]}),{status:200}));
    render(<ApprovalPage/>);
    expect(await screen.findByRole("radio",{name:"红色：已完成"})).toBeInTheDocument();
    expect(screen.getByRole("radio",{name:"灰色：未完成"})).toBeInTheDocument();
    expect(screen.queryByText(/score|分数|评分/i)).not.toBeInTheDocument();
  });

  it("keeps approvers in the configured order",async()=>{
    const user=userEvent.setup();
    render(<ApproversPage/>);
    await user.type(screen.getByLabelText("员工 ID"),"employee-1");
    await user.type(screen.getByLabelText("审批人 ID（每行一个）"),"leader-b\nleader-a");
    expect(screen.getByText("第 1 级：leader-b")).toBeInTheDocument();
    expect(screen.getByText("第 2 级：leader-a")).toBeInTheDocument();
  });

  it("validates schedule settings before saving",async()=>{
    const user=userEvent.setup();
    render(<SettingsPage/>);
    await user.clear(screen.getByLabelText("日志截止时间"));
    await user.type(screen.getByLabelText("日志截止时间"),"25:90");
    await user.click(screen.getByRole("button",{name:"保存设置"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("时间格式");
  });
});
