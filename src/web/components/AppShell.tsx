import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import type { SessionUser } from "../api/client.js";
import { ReminderMenu } from "./ReminderMenu.js";

const nav = {
  EMPLOYEE: [
    ["今日日志", "/employee/today"],
    ["历史日志", "/employee/history"],
    ["我的统计", "/employee/stats"]
  ],
  LEADER: [
    ["待审日志", "/leader/approvals"],
    ["日志查询", "/leader/logs"],
    ["部门统计", "/reports/departments"]
  ],
  MANAGEMENT: [
    ["公司总览", "/management"],
    ["全部日志", "/leader/logs"],
    ["奖惩确认", "/management/rewards"]
  ],
  ADMIN: [
    ["用户管理", "/admin/users"],
    ["部门管理", "/admin/departments"],
    ["审批配置", "/admin/approvers"],
    ["系统设置", "/admin/settings"],
    ["审计记录", "/admin/audit"]
  ]
} as const;

export function AppShell({ user, onLogout, children }: {
  user: SessionUser;
  onLogout(): Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">志</div><div><strong>工作志</strong><small>WORKLOG</small></div></div>
        <nav aria-label="主导航">
          {nav[user.role].map(([label, href]) => (
            <NavLink key={href} to={href} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot"><span className="online-dot" /><div><strong>{user.displayName ?? user.username}</strong><small>{user.role}</small></div></div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">DAILY WORKLOG</p><strong>员工工作日志管理系统</strong></div>
          <div className="top-actions"><ReminderMenu /><button className="btn secondary" onClick={() => void onLogout()}>退出登录</button></div>
        </header>
        {children}
      </section>
    </div>
  );
}
