import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./auth/AuthProvider.js";
import type { SessionUser } from "./api/client.js";
import { AppShell } from "./components/AppShell.js";
import { ChangeInitialPasswordPage } from "./pages/ChangeInitialPasswordPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { EmployeeStatsPage } from "./pages/employee/EmployeeStatsPage.js";
import { HistoryPage } from "./pages/employee/HistoryPage.js";
import { TodayLogPage } from "./pages/employee/TodayLogPage.js";
import { BackfillPage } from "./pages/employee/BackfillPage.js";
import { EmployeeProfilePage } from "./pages/employee/EmployeeProfilePage.js";
import { ApprovalPage } from "./pages/leader/ApprovalPage.js";
import { LogSearchPage } from "./pages/leader/LogSearchPage.js";
import { LogDetailPage } from "./pages/leader/LogDetailPage.js";
import { DashboardPage } from "./pages/management/DashboardPage.js";
import { RewardsPage } from "./pages/management/RewardsPage.js";
import { RecycleBinPage } from "./pages/management/RecycleBinPage.js";
import { UsersPage } from "./pages/admin/UsersPage.js";
import { DepartmentsPage } from "./pages/admin/DepartmentsPage.js";
import { ApproversPage } from "./pages/admin/ApproversPage.js";
import { SettingsPage } from "./pages/admin/SettingsPage.js";
import { AuditPage } from "./pages/admin/AuditPage.js";
import { ArchivesPage, ArchiveDetailPage } from "./pages/archives/ArchivesPage.js";
import { PersonnelPage } from "./pages/hr/PersonnelPage.js";
import { HrStatusPage } from "./pages/hr/StatusPage.js";
import { ExemptionsPage } from "./pages/hr/ExemptionsPage.js";

const homes: Record<SessionUser["role"], string> = { EMPLOYEE: "/employee/today", LEADER: "/leader/approvals", MANAGEMENT: "/management", ADMIN: "/admin/users", HR: "/hr/personnel" };
const archiveRoles = ["EMPLOYEE", "LEADER", "MANAGEMENT"] as const;
const logRoles = ["EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN"] as const;
export function AppRouter() {
  const auth = useAuth();
  if (auth.loading) return <main className="center-page"><p>正在加载…</p></main>;
  if (!auth.user) return <LoginPage onLogin={auth.login} />;
  if (auth.user.mustChangePassword) return <ChangeInitialPasswordPage onChange={auth.changeInitialPassword} />;
  const { role, employmentStatus } = auth.user;
  const departed = employmentStatus === "DEPARTED";
  const home = departed ? "/employee/profile" : homes[role];
  const guard = (roles: readonly SessionUser["role"][], element: ReactNode, allowDeparted = false) => roles.includes(role) && (!departed || allowDeparted) ? element : <Navigate to={home} replace />;
  return <AppShell user={auth.user} onLogout={auth.logout}><Routes>
    <Route path="*" element={<Navigate to={home} replace />} />
    <Route path="/employee/today" element={guard(["EMPLOYEE"], <TodayLogPage />)} />
    <Route path="/employee/profile" element={guard(archiveRoles, <EmployeeProfilePage allowDepartment={role === "EMPLOYEE" && !departed} />, true)} />
    <Route path="/employee/backfill" element={guard(["EMPLOYEE"], <BackfillPage />)} />
    <Route path="/employee/history" element={guard(archiveRoles, <HistoryPage canBackfill={!departed && role === "EMPLOYEE"} />, true)} />
    <Route path="/employee/logs/:id" element={guard(logRoles, <LogDetailPage backTo="/employee/history" canBackfill={!departed && role === "EMPLOYEE"} canReply={!departed && role === "EMPLOYEE"} />, true)} />
    <Route path="/employee/stats" element={guard(logRoles, <EmployeeStatsPage />)} />
    <Route path="/departments" element={guard(["ADMIN", "LEADER", "MANAGEMENT"], <DepartmentsPage role={role} />)} />
    <Route path="/archives" element={guard(["LEADER", "MANAGEMENT"], <ArchivesPage />)} />
    <Route path="/archives/:id" element={guard(["LEADER", "MANAGEMENT"], <ArchiveDetailPage />)} />
    <Route path="/leader/approvals" element={guard(["LEADER", "MANAGEMENT", "ADMIN"], <ApprovalPage />)} />
    <Route path="/leader/logs" element={guard(logRoles, <LogSearchPage />)} />
    <Route path="/leader/logs/:id" element={guard(logRoles, <LogDetailPage />)} />
    <Route path="/reports/departments" element={guard(["LEADER", "MANAGEMENT", "ADMIN"], <DashboardPage />)} />
    <Route path="/management" element={guard(["MANAGEMENT", "ADMIN"], <DashboardPage />)} />
    <Route path="/management/rewards" element={guard(["LEADER", "MANAGEMENT", "ADMIN"], <RewardsPage />)} />
    <Route path="/management/recycle-bin" element={guard(["MANAGEMENT"], <RecycleBinPage />)} />
    <Route path="/hr/personnel" element={guard(["HR"], <PersonnelPage />)} />
    <Route path="/hr/status" element={guard(["HR"], <HrStatusPage />)} />
    <Route path="/hr/exemptions" element={guard(["HR"], <ExemptionsPage />)} />
    <Route path="/admin/users" element={guard(["ADMIN"], <UsersPage />)} />
    <Route path="/admin/departments" element={guard(["ADMIN"], <DepartmentsPage role={role} />)} />
    <Route path="/admin/approvers" element={guard(["ADMIN"], <ApproversPage />)} />
    <Route path="/admin/settings" element={guard(["ADMIN"], <SettingsPage />)} />
    <Route path="/admin/audit" element={guard(["MANAGEMENT", "ADMIN"], <AuditPage />)} />
  </Routes></AppShell>;
}
