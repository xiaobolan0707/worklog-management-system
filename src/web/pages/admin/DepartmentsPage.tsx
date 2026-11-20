import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest, type SessionUser } from "../../api/client.js";

interface Department { id: string; name: string; employeeNumberPrefix?: string | null }
interface Employee { id: string; username: string; displayName: string | null; departmentId: string; accountStatus: "ACTIVE" | "DISABLED" }
type EmployeeEditor = { mode: "create" } | { mode: "edit"; employee: Employee };

export function DepartmentsPage({ role }: { role: SessionUser["role"] }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editingPrefix, setEditingPrefix] = useState(false);
  const [editor, setEditor] = useState<EmployeeEditor | null>(null);
  const [removingId, setRemovingId] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [candidates, setCandidates] = useState<Employee[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const department = departments.find((item) => item.id === selectedId);
  const isAdmin = role === "ADMIN";

  useEffect(() => {
    if (role === "EMPLOYEE") return;
    let active = true;
    setLoading(true);
    void apiRequest<{ departments: Department[] }>("/departments").then((result) => {
      if (!active) return;
      setDepartments(result.departments);
      setSelectedId((current) => result.departments.some((item) => item.id === current) ? current : result.departments[0]?.id ?? "");
    }).catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : "部门加载失败，请重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [role, reloadKey]);

  useEffect(() => {
    setEmployees([]); setEditor(null); setRenaming(false); setEditingPrefix(false);
    if (!selectedId) return;
    let active = true;
    setEmployeesLoading(true);
    void apiRequest<{ employees: Employee[] }>(`/departments/${selectedId}/employees`).then((result) => {
      if (active) setEmployees(result.employees);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : "员工列表加载失败，请重试"); })
      .finally(() => { if (active) setEmployeesLoading(false); });
    return () => { active = false; };
  }, [selectedId, reloadKey]);

  function beginAction() { setError(""); setNotice(""); }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    beginAction();
    if (!name) { setError("请填写部门名称"); return; }
    setSaving(true);
    try {
      const result = await apiRequest<{ department: Department }>("/admin/departments", { method: "POST", body: JSON.stringify({ name }) });
      setDepartments((current) => [...current, result.department].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(result.department.id); form.reset();
      setNotice(`部门“${result.department.name}”已创建`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "部门创建失败，请稍后重试"); }
    finally { setSaving(false); }
  }

  async function renameDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!department || saving) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    beginAction();
    if (!name) { setError("请填写部门名称"); return; }
    setSaving(true);
    try {
      const result = await apiRequest<{ department: Department }>(`/admin/departments/${department.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setDepartments((current) => current.map((item) => item.id === result.department.id ? { ...item, ...result.department } : item).sort((a, b) => a.name.localeCompare(b.name)));
      setRenaming(false); setNotice(`部门名称已更新为“${result.department.name}”，员工归属保持不变`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "部门名称保存失败，请稍后重试"); }
    finally { setSaving(false); }
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!department || !editor || saving) return;
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "").trim();
    beginAction();
    if (!username || !displayName) { setError("请填写员工姓名和用户名"); return; }
    const payload = editor.mode === "create" ? { username, displayName, initialPassword: String(data.get("initialPassword") ?? "") }
      : { username, displayName, departmentId: String(data.get("departmentId") ?? "") };
    const url = `/departments/${department.id}/employees${editor.mode === "edit" ? `/${editor.employee.id}` : ""}`;
    setSaving(true);
    try {
      const result = await apiRequest<{ user: Employee }>(url, { method: editor.mode === "create" ? "POST" : "PATCH", body: JSON.stringify(payload) });
      setEmployees((current) => {
        const remaining = current.filter((employee) => employee.id !== result.user.id);
        return (result.user.departmentId === department.id ? [...remaining, result.user] : remaining).sort((a, b) => a.username.localeCompare(b.username));
      });
      setNotice(editor.mode === "create" ? `员工已添加到“${department.name}”，首次登录需修改初始密码` : "员工信息已保存，部门归属已同步");
      setEditor(null);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "员工信息保存失败，请稍后重试"); }
    finally { setSaving(false); }
  }

  async function removeEmployee(employee: Employee) {
    if (!department || saving || removingId) return;
    const name = employee.displayName || employee.username;
    const confirmed = window.confirm(
      `确认将 ${name} 移出“${department.name}”？\n\n` +
      "移出后：该员工不再出现在本部门员工列表，历史日志与工作计划不受影响；\n" +
      "工号会保留三个月，不会随离职释放或重新分配。"
    );
    if (!confirmed) return;
    beginAction(); setRemovingId(employee.id);
    try {
      const result = await apiRequest<{ employeeNumberLabel: string | null; numberRetainedUntil: string }>(
        `/departments/${department.id}/employees/${employee.id}`, { method: "DELETE" }
      );
      setEmployees((current) => current.filter((item) => item.id !== employee.id));
      if (editor?.mode === "edit" && editor.employee.id === employee.id) setEditor(null);
      const until = result.numberRetainedUntil.slice(0, 10);
      setNotice(result.employeeNumberLabel
        ? `${name} 已移出“${department.name}”，工号 ${result.employeeNumberLabel} 保留至 ${until}。`
        : `${name} 已移出“${department.name}”（该员工尚未分配工号）。`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "移出部门失败，请稍后重试"); }
    finally { setRemovingId(""); }
  }

  async function openAssign() {
    if (!department) return;
    beginAction(); setAssignOpen(true); setAssigning(true);
    try {
      const result = await apiRequest<{ employees: Employee[] }>("/departments/employees");
      setCandidates(result.employees.filter((item) => item.departmentId !== department.id));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "员工列表加载失败，请重试"); setAssignOpen(false); }
    finally { setAssigning(false); }
  }

  async function assignEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!department || assigning) return;
    const employeeId = String(new FormData(event.currentTarget).get("employeeId") ?? "");
    beginAction();
    if (!employeeId) { setError("请选择要调入的员工"); return; }
    setAssigning(true);
    try {
      const result = await apiRequest<{ user: Employee }>(`/departments/${department.id}/assign`, { method: "POST", body: JSON.stringify({ employeeId }) });
      setEmployees((current) => [...current.filter((item) => item.id !== result.user.id), result.user].sort((a, b) => a.username.localeCompare(b.username)));
      setCandidates((current) => current.filter((item) => item.id !== employeeId));
      setAssignOpen(false);
      setNotice(`${result.user.displayName ?? result.user.username} 已调入“${department.name}”`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "调入失败，请重试"); }
    finally { setAssigning(false); }
  }

  async function savePrefix(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!department || saving) return;
    const prefix = String(new FormData(event.currentTarget).get("prefix") ?? "").trim() || null;
    beginAction(); setSaving(true);
    try {
      await apiRequest(`/admin/departments/${department.id}/number-prefix`, { method: "PATCH", body: JSON.stringify({ prefix }) });
      setDepartments((current) => current.map((item) => item.id === department.id ? { ...item, employeeNumberPrefix: prefix } : item));
      setEditingPrefix(false); setNotice("部门工号标识已保存，留空时使用部门名称展示工号");
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "工号标识保存失败，请重试"); }
    finally { setSaving(false); }
  }

  if (role === "EMPLOYEE") return <main className="page"><p role="alert" className="form-error">无权访问部门员工管理。</p></main>;
  return <main className="page">
    <div className="page-head"><div><h1>{isAdmin ? "部门管理" : "部门员工"}</h1><p>{role === "LEADER" ? "查看和维护本部门员工。" : "按部门查看员工，维护姓名、登录账号与部门归属。"}</p></div></div>
    {error && <div className="department-feedback"><p className="form-error" role="alert">{error}</p><button type="button" className="btn secondary" disabled={saving} onClick={() => { beginAction(); setReloadKey((current) => current + 1); }}>重新加载</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="department-layout">
      <section className="panel department-list" aria-label="部门列表">
        <h2>部门列表</h2>
        {loading ? <p className="muted" role="status">正在加载部门…</p> : departments.length === 0 ? <p className="muted">{role === "LEADER" ? "当前未分配部门，请联系管理员。" : "暂无部门，请先创建部门。"}</p> :
          <div className="department-buttons">{departments.map((item) => <button type="button" key={item.id} className={`department-button${selectedId === item.id ? " is-selected" : ""}`} aria-current={selectedId === item.id ? "true" : undefined} disabled={saving} onClick={() => { beginAction(); setSelectedId(item.id); }}>{item.name}</button>)}</div>}
        {isAdmin && <form className="department-create" onSubmit={createDepartment}><label className="field"><span>新增部门名称</span><input name="name" maxLength={100} required disabled={saving} /></label><button className="btn secondary" disabled={saving}>新增部门</button></form>}
      </section>
      <section className="panel department-employees" aria-label="部门员工">
        {department ? <>
          <div className="department-heading"><div><h2>{department.name}</h2><p className="muted">{employeesLoading ? "正在加载员工…" : `${employees.length} 名员工`}</p></div><div className="form-actions">
            {isAdmin && <button type="button" className="btn secondary" disabled={saving} onClick={() => { beginAction(); setRenaming(true); }}>编辑部门名称</button>}
            {isAdmin && <button type="button" className="btn secondary" disabled={saving} onClick={() => { beginAction(); setEditingPrefix(true); }}>设置工号标识</button>}
            {role !== "HR" && <button type="button" className="btn primary" disabled={saving || employeesLoading} onClick={() => { beginAction(); setEditor({ mode: "create" }); }}>添加员工</button>}
            <button type="button" className="btn secondary" disabled={saving || employeesLoading} onClick={() => void openAssign()}>调入员工</button>
          </div></div>
          {renaming && isAdmin && <form className="department-rename" onSubmit={renameDepartment}><label className="field"><span>新部门名称</span><input name="name" defaultValue={department.name} maxLength={100} autoFocus required disabled={saving} /></label><div className="form-actions"><button className="btn primary" disabled={saving}>{saving ? "保存中…" : "保存部门名称"}</button><button type="button" className="btn secondary" disabled={saving} onClick={() => setRenaming(false)}>取消</button></div></form>}
          {editingPrefix && isAdmin && <form className="department-rename" onSubmit={savePrefix}><label className="field"><span>部门工号标识（可留空）</span><input name="prefix" defaultValue={department.employeeNumberPrefix ?? ""} maxLength={20} pattern="[\s\S]*" autoFocus disabled={saving} /></label><p className="muted">留空时显示“{department.name} 0001”；配置后显示“标识0001”。各部门序号独立递增，不会因更改标识重新分配。</p><div className="form-actions"><button className="btn primary" disabled={saving}>保存工号标识</button><button type="button" className="btn secondary" disabled={saving} onClick={() => setEditingPrefix(false)}>取消</button></div></form>}
          {assignOpen && department && <form className="department-rename" onSubmit={assignEmployee}><label className="field"><span>从现有员工中选择</span><select name="employeeId" defaultValue="" required disabled={assigning}><option value="">请选择员工</option>{candidates.map((item) => <option key={item.id} value={item.id}>{`${item.displayName ?? item.username}（${item.username}）· ${departments.find((d) => d.id === item.departmentId)?.name ?? "未分配"}`}</option>)}</select></label><p className="muted">调入后该员工的历史日志与工作计划不受影响，仅归属部门变更。</p><div className="form-actions"><button className="btn primary" disabled={assigning}>{assigning ? "调入中…" : "确认调入"}</button><button type="button" className="btn secondary" disabled={assigning} onClick={() => setAssignOpen(false)}>取消</button></div></form>}
          {!employeesLoading && (employees.length === 0 ? <p className="department-empty">该部门暂无员工，可添加新员工。</p> : <div className="table-wrap"><table aria-label={`${department.name}员工列表`}><thead><tr><th scope="col">员工姓名</th><th scope="col">用户名</th><th scope="col">账号状态</th><th scope="col">操作</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td>{employee.displayName || "未填写姓名"}</td><td>{employee.username}</td><td>{employee.accountStatus === "ACTIVE" ? "启用" : "停用"}</td><td><div className="form-actions"><button type="button" className="btn secondary" aria-label={`修改${employee.displayName || employee.username}`} disabled={saving} onClick={() => { beginAction(); setEditor({ mode: "edit", employee }); }}>修改</button>{employee.accountStatus === "DISABLED" && <button type="button" className="btn secondary" aria-label={`将${employee.displayName || employee.username}移出部门`} disabled={saving || Boolean(removingId)} onClick={() => void removeEmployee(employee)}>{removingId === employee.id ? "移出中…" : "移出部门"}</button>}</div></td></tr>)}</tbody></table></div>)}
          {editor && <form className="department-employee-form" key={editor.mode === "edit" ? editor.employee.id : "create"} onSubmit={saveEmployee}>
            <h3>{editor.mode === "create" ? `添加员工至${department.name}` : "修改员工信息"}</h3>
            <div className="department-form-grid">
              <label className="field"><span>员工姓名</span><input name="displayName" defaultValue={editor.mode === "edit" ? editor.employee.displayName ?? "" : ""} maxLength={100} autoFocus required disabled={saving} /></label>
              <div className="field"><label htmlFor="department-employee-username">用户名（登录账号）</label><input id="department-employee-username" name="username" defaultValue={editor.mode === "edit" ? editor.employee.username : ""} minLength={2} maxLength={64} pattern={"[A-Za-z0-9._\\-]+"} aria-describedby="employee-username-hint" autoComplete="off" required disabled={saving} /><small className="muted" id="employee-username-hint">支持字母、数字、点、下划线和短横线。{editor.mode === "edit" && "修改后需使用新用户名登录。"}</small></div>
              {editor.mode === "create" ? <label className="field"><span>初始密码</span><input name="initialPassword" type="password" autoComplete="new-password" minLength={6} maxLength={256} required disabled={saving} /></label> : <div className="field"><label htmlFor="department-employee-department">所属部门</label><select id="department-employee-department" name="departmentId" defaultValue={editor.employee.departmentId} required disabled={saving}>{departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>}
            </div>
            <div className="form-actions"><button className="btn primary" disabled={saving}>{saving ? "保存中…" : editor.mode === "create" ? "创建员工" : "保存员工信息"}</button><button type="button" className="btn secondary" disabled={saving} onClick={() => setEditor(null)}>取消</button></div>
          </form>}
        </> : <p className="department-empty">{loading ? "正在加载…" : "请选择部门后查看员工。"}</p>}
      </section>
    </div>
  </main>;
}
