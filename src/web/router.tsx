import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthProvider.js";
import { AppShell } from "./components/AppShell.js";
import { ChangeInitialPasswordPage } from "./pages/ChangeInitialPasswordPage.js";
import { LoginPage } from "./pages/LoginPage.js";

function Placeholder({ title }: { title: string }) {
  return <main className="page"><div className="page-head"><div><p className="eyebrow">WORKSPACE</p><h1>{title}</h1><p>功能页面正在加载。</p></div></div></main>;
}

const homes = {
  EMPLOYEE: "/employee/today",
  LEADER: "/leader/approvals",
  MANAGEMENT: "/management",
  ADMIN: "/admin/users"
} as const;

export function AppRouter() {
  const auth = useAuth();
  if (auth.loading) return <main className="center-page"><p>正在加载…</p></main>;
  if (!auth.user) return <LoginPage onLogin={auth.login} />;
  if (auth.user.mustChangePassword) {
    return <ChangeInitialPasswordPage onChange={auth.changeInitialPassword} />;
  }
  return (
    <AppShell user={auth.user} onLogout={auth.logout}>
      <Routes>
        <Route path="*" element={<Navigate to={homes[auth.user.role]} replace />} />
        {Object.values(navTitles).map(([path, title]) => <Route key={path} path={path} element={<Placeholder title={title} />} />)}
      </Routes>
    </AppShell>
  );
}

const navTitles = {
  today: ["/employee/today", "今日工作日志"],
  history: ["/employee/history", "历史日志"],
  stats: ["/employee/stats", "我的统计"],
  approvals: ["/leader/approvals", "待审日志"],
  logs: ["/leader/logs", "日志查询"],
  department: ["/reports/departments", "部门统计"],
  management: ["/management", "公司总览"],
  rewards: ["/management/rewards", "奖惩确认"],
  users: ["/admin/users", "用户管理"],
  departments: ["/admin/departments", "部门管理"],
  approvers: ["/admin/approvers", "审批配置"],
  settings: ["/admin/settings", "系统设置"],
  audit: ["/admin/audit", "审计记录"]
} as const;
