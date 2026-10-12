// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApprovalPage } from "../../../src/web/pages/leader/ApprovalPage.js";
import { LogSearchPage } from "../../../src/web/pages/leader/LogSearchPage.js";
import { ApproversPage } from "../../../src/web/pages/admin/ApproversPage.js";
import { SettingsPage } from "../../../src/web/pages/admin/SettingsPage.js";
import { UsersPage } from "../../../src/web/pages/admin/UsersPage.js";

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("leader and administrator pages",()=>{
  it("offers only red or gray approval and never renders a score",async()=>{
    const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
      if(init?.method==="POST")return new Response(JSON.stringify({log:{id:"log-1"}}),{status:200});
      return new Response(JSON.stringify({logs:[{id:"log-1",employeeId:"employee-1",employeeName:"张三",workDate:"2026-10-10",items:[1,2,3,4].map(position=>({position,content:`工作事项 ${position}`,completed:true,images:[]})),approvalSteps:[]}]}),{status:200});
    });
    const user=userEvent.setup();
    render(<ApprovalPage/>);
    expect(await screen.findByRole("radio",{name:"红色：已完成"})).toBeInTheDocument();
    expect(screen.getByRole("radio",{name:"灰色：未完成"})).toBeInTheDocument();
    expect(screen.getByText("员工姓名：张三")).toBeInTheDocument();
    expect(screen.queryByText("employee-1")).not.toBeInTheDocument();
    expect(screen.getByText("当天或次日核查，只选择红色完成或灰色未完成。")).toBeInTheDocument();
    expect(screen.queryByText(/score|分数|评分/i)).not.toBeInTheDocument();
    for(const position of [1,2,3,4])await user.type(screen.getByLabelText(`事项 ${position} 批注`),`事项 ${position} 已核查`);
    await user.click(screen.getByRole("button",{name:"确认核查"}));
    await waitFor(()=>expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/approvals/log-1/approve",
      expect.objectContaining({body:JSON.stringify({color:"RED",itemComments:[1,2,3,4].map(itemPosition=>({itemPosition,comment:`事项 ${itemPosition} 已核查`}))})})
    ));
  });

  it("shows employee names instead of internal ids in log search",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({logs:[
      {id:"log-1",employeeId:"employee-1",employeeName:"张三",workDate:"2026-10-11",status:"ARCHIVED",color:"RED"}
    ]}),{status:200}));
    render(<MemoryRouter><LogSearchPage/></MemoryRouter>);
    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.queryByText("employee-1")).not.toBeInTheDocument();
    expect(screen.getByRole("link",{name:"查看完整信纸"})).toHaveAttribute("href","/leader/logs/log-1");
  });

  it("keeps approvers in the configured order",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({users:[
      {id:"employee-1",username:"employee",displayName:"员工",role:"EMPLOYEE"},
      {id:"leader-b",username:"leader-b",displayName:"乙领导",role:"LEADER"},
      {id:"leader-a",username:"leader-a",displayName:"甲领导",role:"LEADER"}
    ]}),{status:200}));
    const user=userEvent.setup();
    render(<ApproversPage/>);
    await user.selectOptions(await screen.findByLabelText("员工"),"employee-1");
    await user.selectOptions(screen.getByLabelText("添加审批人"),"leader-b");
    await user.click(screen.getByRole("button",{name:"加入审批链"}));
    await user.selectOptions(screen.getByLabelText("添加审批人"),"leader-a");
    await user.click(screen.getByRole("button",{name:"加入审批链"}));
    expect(screen.getByText("第 1 级：乙领导（leader-b）")).toBeInTheDocument();
    expect(screen.getByText("第 2 级：甲领导（leader-a）")).toBeInTheDocument();
  });

  it("validates schedule settings before saving",async()=>{
    const user=userEvent.setup();
    render(<SettingsPage/>);
    await user.clear(screen.getByLabelText("日志截止时间"));
    await user.type(screen.getByLabelText("日志截止时间"),"25:90");
    await user.click(screen.getByRole("button",{name:"保存设置"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("时间格式");
  });

  it("confirms and deletes an unused user from user management",async()=>{
    let users=[{id:"user-1",username:"unused",displayName:"待删除用户",role:"EMPLOYEE",accountStatus:"ACTIVE"}];
    const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
      const url=String(input);
      if(url.endsWith("/api/admin/departments"))return new Response(JSON.stringify({departments:[]}),{status:200});
      if(url.endsWith("/api/admin/users/user-1")&&init?.method==="DELETE"){
        users=[];
        return new Response(null,{status:204});
      }
      if(url.endsWith("/api/admin/users"))return new Response(JSON.stringify({users}),{status:200});
      return new Response(null,{status:404});
    });
    vi.spyOn(window,"confirm").mockReturnValue(true);
    const user=userEvent.setup();

    render(<UsersPage/>);
    await user.click(await screen.findByRole("button",{name:"删除待删除用户"}));

    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/user-1",
      expect.objectContaining({method:"DELETE"})
    ));
    expect(screen.queryByText("待删除用户")).not.toBeInTheDocument();
  });
});
