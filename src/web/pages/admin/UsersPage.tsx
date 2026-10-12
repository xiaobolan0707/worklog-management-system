import { useEffect, useState, type FormEvent } from "react";

import { ApiError, apiRequest } from "../../api/client.js";

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  accountStatus: "ACTIVE" | "DISABLED";
}
interface Department { id: string; name: string }

export function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [notice, setNotice] = useState("");
  const [resetUserId, setResetUserId] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  async function load() {
    const [userResult, departmentResult] = await Promise.all([
      apiRequest<{ users: AdminUser[] }>("/admin/users"),
      apiRequest<{ departments: Department[] }>("/admin/departments")
    ]);
    setUsers(userResult.users);
    setDepartments(departmentResult.departments);
  }
  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(data) as Record<string, FormDataEntryValue>;
    if (!payload["departmentId"]) delete payload["departmentId"];
    await apiRequest("/admin/users", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    setNotice("账号已创建，首次登录必须改密码");
    await load();
  }

  async function reset() {
    await apiRequest(`/admin/users/${resetUserId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ initialPassword: resetPassword })
    });
    setNotice("密码已重置，原会话已失效");
    setResetPassword("");
  }

  async function toggle(user: AdminUser) {
    await apiRequest(`/admin/users/${user.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ accountStatus: user.accountStatus === "ACTIVE" ? "DISABLED" : "ACTIVE" })
    });
    await load();
  }

  async function remove(user: AdminUser) {
    const label = user.displayName || user.username;
    if (!window.confirm(`确定删除用户“${label}”吗？账号将永久停用，但历史业务记录会保留。`)) return;
    try {
      await apiRequest(`/admin/users/${user.id}`, { method: "DELETE" });
      if (resetUserId === user.id) setResetUserId("");
      setNotice(`用户“${label}”已删除`);
      await load();
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "删除失败，请稍后重试");
    }
  }

  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">ACCOUNT ADMIN</p><h1>用户管理</h1><p>由管理员创建账号和初始密码。</p></div></div>
    <div className="admin-grid">
      <form className="panel" onSubmit={create}><h2>创建账号</h2><label className="field"><span>用户名</span><input name="username" required /></label><label className="field"><span>姓名</span><input name="displayName" required /></label><label className="field"><span>初始密码</span><input name="initialPassword" type="password" minLength={12} required /></label><label className="field"><span>角色</span><select name="role"><option value="EMPLOYEE">员工</option><option value="LEADER">领导</option><option value="MANAGEMENT">管理层</option><option value="ADMIN">管理员</option></select></label><label className="field"><span>所属部门</span><select name="departmentId"><option value="">不指定</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><button className="btn primary">创建用户</button></form>
      <section className="panel"><h2>重置密码</h2><label className="field"><span>选择用户</span><select value={resetUserId} onChange={(event) => setResetUserId(event.target.value)}><option value="">请选择</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.username}（{user.username}）</option>)}</select></label><label className="field"><span>新初始密码</span><input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} type="password" minLength={12} /></label><button className="btn secondary" disabled={!resetUserId || resetPassword.length < 12} onClick={() => void reset()}>重置密码</button></section>
    </div>
    {notice && <p className="notice">{notice}</p>}
    <section className="panel table-wrap"><table><thead><tr><th>姓名</th><th>用户名</th><th>角色</th><th>状态</th><th>用户 ID</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.displayName || "-"}</td><td>{user.username}</td><td>{user.role}</td><td>{user.accountStatus === "ACTIVE" ? "启用" : "停用"}</td><td><code>{user.id}</code></td><td><div className="form-actions"><button className="btn secondary" onClick={() => void toggle(user)}>{user.accountStatus === "ACTIVE" ? "停用" : "启用"}</button><button className="btn secondary" aria-label={`删除${user.displayName||user.username}`} onClick={() => void remove(user)}>删除</button></div></td></tr>)}</tbody></table></section>
  </main>;
}
