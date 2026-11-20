import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import type { SessionUser } from "../api/client.js";
import { ReminderMenu } from "./ReminderMenu.js";
import { Icon } from "./Icon.js";
import { roleLabels } from "../labels.js";

const nav = {
  EMPLOYEE: [
    ["今日日志", "/employee/today", "journal"],
    ["工作计划", "/employee/work-plan", "plan"],
    ["历史日志", "/employee/history", "history"],
    ["我的档案", "/employee/profile", "idcard"],
    ["我的统计", "/employee/stats", "chart"],
    ["员工排行榜", "/reports/leaderboard", "star"],
    ["全员状态", "/status", "board"]
  ],
  LEADER: [
    ["待审日志", "/leader/approvals", "approval"],
    ["待评计划", "/leader/plan-approvals", "plan"],
    ["部门员工", "/departments", "department"],
    ["员工档案", "/archives", "users"],
    ["我的档案", "/employee/profile", "idcard"],
    ["日志查询", "/leader/logs", "search"],
    ["员工排行榜", "/reports/leaderboard", "star"],
    ["公司总览", "/management", "dashboard"],
    ["全员状态", "/status", "board"]
  ],
  MANAGEMENT: [
    ["公司总览", "/management", "dashboard"],
    ["待审日志", "/leader/approvals", "approval"],
    ["待评计划", "/leader/plan-approvals", "plan"],
    ["员工排行榜", "/reports/leaderboard", "star"],
    ["部门员工", "/departments", "department"],
    ["员工档案", "/archives", "users"],
    ["我的档案", "/employee/profile", "idcard"],
    ["资料回收站", "/management/recycle-bin", "history"],
    ["全部日志", "/leader/logs", "journal"],
    ["全员状态", "/status", "board"]
  ],
  HR: [
    ["公司总览", "/management", "dashboard"],
    ["员工排行榜", "/reports/leaderboard", "star"],
    ["人员管理", "/hr/personnel", "users"],
    ["部门管理", "/departments", "folder"],
    ["档案提交跟进", "/hr/archive-tracking", "idcard"],
    ["日志状态台账", "/hr/status", "journal"],
    ["免交日设置", "/hr/exemptions", "settings"],
    ["全员状态", "/status", "board"]
  ],
  ADMIN: [
    ["公司总览", "/management", "dashboard"],
    ["待评计划", "/leader/plan-approvals", "plan"],
    ["员工排行榜", "/reports/leaderboard", "star"],
    ["用户管理", "/admin/users", "users"],
    ["部门管理", "/admin/departments", "department"],
    ["审批配置", "/admin/approvers", "approval"],
    ["系统设置", "/admin/settings", "settings"],
    ["审计记录", "/admin/audit", "history"],
    ["全员状态", "/status", "board"]
  ]
} as const;

/** 所有角色都能进的组件实验室入口；正式部署时可整行移除。 */

export function AppShell({ user, onLogout, children }: {
  user: SessionUser;
  onLogout(): Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">跳转到主要内容</a>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">志</div><div><strong>工作志</strong><small>WORKLOG</small></div></div>
        <p className="nav-caption">{roleLabels[user.role]}工作台</p>
        <nav aria-label="主导航">
          {(user.employmentStatus === "DEPARTED" ? [["我的档案", "/employee/profile", "idcard"], ["历史日志", "/employee/history", "history"]] as const : [...nav[user.role]]).map(([label, href, icon]) => (
            <NavLink key={href} to={href} end={href === "/management"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon name={icon} />{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot"><span className="user-avatar" aria-hidden="true">{(user.displayName || user.username).slice(0, 1)}</span><div><strong>{user.displayName ?? user.username}</strong><small>{roleLabels[user.role]}</small></div></div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="workspace-label"><span>工作空间</span><span aria-hidden="true">/</span><strong>员工工作日志</strong></div>
          <div className="top-actions"><span className="top-date">{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span><ReminderMenu canOpenLogs={user.role !== "HR"} logPath={user.role === "EMPLOYEE" || user.employmentStatus === "DEPARTED" ? "/employee/logs" : "/leader/logs"} /><Link className="btn secondary" to="/account/password">修改密码</Link><button className="btn secondary" onClick={() => void onLogout()}><Icon name="logout" />退出登录</button></div>
        </header>
        <div id="workspace-content" tabIndex={-1}>{children}</div>
      </section>
    </div>
  );
}
