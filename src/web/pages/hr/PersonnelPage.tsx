import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../../api/client.js";
import { archiveDate, requestMessage } from "../archives/ArchivePanel.js";

interface Personnel {
  id: string; displayName: string | null; role: string; departmentId: string | null; departmentName: string | null;
  employeeNumber: number | null; numberDepartmentId: string | null; hireDate: string | null; departureDate: string | null; employmentStatus: "ACTIVE" | "DEPARTED";
}
interface Department { id: string; name: string; employeeNumberPrefix: string | null }

export function PersonnelPage() {
  const [employees, setEmployees] = useState<Personnel[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managers, setManagers] = useState<{ id: string; displayName: string | null }[]>([]);
  const [editing, setEditing] = useState<Personnel | null>(null);
  const [status, setStatus] = useState("ACTIVE");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    void apiRequest<{ employees: Personnel[]; departments: Department[]; managers: typeof managers }>("/hr/personnel").then((result) => {
      if (active) { setEmployees(result.employees); setDepartments(result.departments); setManagers(result.managers); }
    }).catch((cause) => { if (active) setError(requestMessage(cause, "人员信息加载失败")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing || busy) return;
    const data = new FormData(event.currentTarget);
    const hireDate = String(data.get("hireDate") ?? "") || null;
    const departureDate = String(data.get("departureDate") ?? "") || null;
    const handoverManagerId = String(data.get("handoverManagerId") ?? "");
    if (status === "DEPARTED" && !window.confirm(`确定将“${editing.displayName ?? "该员工"}”标记为离职吗？保存后立即变为只读，30 天后禁止登录。`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(`/hr/personnel/${editing.id}`, { method: "PATCH", body: JSON.stringify({ hireDate, departureDate, employmentStatus: status, ...(handoverManagerId ? { handoverManagerId } : {}) }) }); setEditing(null); setNotice("任职信息已保存"); setReload((n) => n + 1); }
    catch (cause) { setError(requestMessage(cause, "任职信息保存失败")); } finally { setBusy(false); }
  }
  async function allocate(employee: Personnel) {
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(`/hr/personnel/${employee.id}/number`, { method: "POST" }); setNotice(`已为${employee.displayName ?? "员工"}分配工号`); setReload((n) => n + 1); }
    catch (cause) { setError(requestMessage(cause, "工号分配失败")); } finally { setBusy(false); }
  }
  function number(employee: Personnel) { const allocated = departments.find((item) => item.id === employee.numberDepartmentId); return employee.employeeNumber == null ? "待分配" : `${allocated?.employeeNumberPrefix || `${allocated?.name ?? employee.departmentName ?? "部门"} `}${String(employee.employeeNumber).padStart(4, "0")}`; }
  return <main className="page"><div className="page-head"><div><h1>人员管理</h1><p>分配工号，维护入离职信息。离职状态保存后立即生效。</p></div></div>
    {error && <div className="department-feedback"><p className="form-error" role="alert">{error}</p><button className="btn secondary" disabled={busy} onClick={() => setReload((n) => n + 1)}>重新加载</button></div>}{notice && <p role="status" className="notice">{notice}</p>}
    <section className="panel"><label className="field archive-filter"><span>筛选部门</span><select aria-label="筛选部门" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">全部部门</option>{departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {loading ? <p role="status">正在加载人员…</p> : <div className="table-wrap"><table><thead><tr><th>姓名</th><th>部门</th><th>工号</th><th>工号分配部门</th><th>入职日期</th><th>离职日期</th><th>状态</th><th>操作</th></tr></thead><tbody>{employees.filter((employee) => !department || employee.departmentId === department).map((employee) => <tr key={employee.id}><td>{employee.displayName ?? "未填写"}</td><td>{employee.departmentName ?? "未分配"}</td><td>{number(employee)}</td><td>{departments.find((item) => item.id === employee.numberDepartmentId)?.name ?? "—"}</td><td>{archiveDate(employee.hireDate)}</td><td>{archiveDate(employee.departureDate)}</td><td>{employee.employmentStatus === "ACTIVE" ? "在职" : "离职"}</td><td><div className="form-actions"><button className="btn secondary" disabled={busy} aria-label={`维护${employee.displayName ?? "员工"}任职信息`} onClick={() => { setEditing(employee); setStatus(employee.employmentStatus); setError(""); setNotice(""); }}>维护任职</button>{employee.employeeNumber == null && <button className="btn secondary" disabled={busy || !employee.departmentId || employee.employmentStatus === "DEPARTED"} aria-label={`为${employee.displayName ?? "员工"}分配工号`} onClick={() => void allocate(employee)}>分配工号</button>}</div></td></tr>)}</tbody></table>{!employees.length && <p className="muted">暂无可维护的员工。</p>}</div>}
    </section>
    {editing && <form className="panel" onSubmit={save} key={editing.id}><h2>维护任职 · {editing.displayName ?? "员工"}</h2><div className="department-form-grid"><label className="field"><span>入职日期</span><input type="date" name="hireDate" defaultValue={editing.hireDate?.slice(0, 10) ?? ""} disabled={busy} /></label><label className="field"><span>任职状态</span><select aria-label="任职状态" value={status} onChange={(event) => setStatus(event.target.value)} disabled={busy}><option value="ACTIVE" disabled={editing.employmentStatus === "DEPARTED"}>在职</option><option value="DEPARTED">离职</option></select></label><label className="field"><span>离职日期</span><input type="date" name="departureDate" defaultValue={editing.departureDate?.slice(0, 10) ?? ""} required={status === "DEPARTED"} disabled={busy} /></label>
      {["LEADER", "MANAGEMENT"].includes(editing.role) && editing.employmentStatus === "ACTIVE" && status === "DEPARTED" && <label className="field"><span>接手审批的管理层</span><select name="handoverManagerId" aria-label="接手审批的管理层" aria-describedby="handover-hint" required={editing.role === "LEADER"} disabled={busy}><option value="">请选择接手人</option>{managers.filter((manager) => manager.id !== editing.id).map((manager) => <option value={manager.id} key={manager.id}>{manager.displayName ?? "未填写姓名"}</option>)}</select><small className="muted" id="handover-hint">未完成审批及后续审批配置将交由此人接手。</small></label>}</div><div className="form-actions"><button className="btn primary" disabled={busy}>{busy ? "保存中…" : "保存任职信息"}</button><button className="btn secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button></div></form>}
  </main>;
}
