import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "../../api/client.js";
import { ArchivePanel } from "../archives/ArchivePanel.js";

interface Profile { id: string; username: string; displayName: string | null; departmentId: string | null }
interface Department { id: string; name: string }

export function EmployeeProfilePage({ allowDepartment = true }: { allowDepartment?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [readOnly, setReadOnly] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([apiRequest<{ user: Profile }>("/profile"), allowDepartment ? apiRequest<{ departments: Department[] }>("/profile/departments") : Promise.resolve({ departments: [] })]).then(([result, options]) => {
      if (!active) return;
      setProfile(result.user); setDepartments(options.departments); setDepartmentId(result.user.departmentId ?? "");
    }).catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : "员工档案加载失败，请重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey, allowDepartment]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!departmentId || saving) return;
    setError(""); setNotice(""); setSaving(true);
    try {
      const result = await apiRequest<{ user: Profile }>("/profile/department", { method: "PUT", body: JSON.stringify({ departmentId }) });
      setProfile(result.user); setDepartmentId(result.user.departmentId ?? "");
      setNotice(`已归入“${departments.find((department) => department.id === result.user.departmentId)?.name ?? "所选部门"}”，部门员工列表已同步`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "部门归属保存失败，请稍后重试"); }
    finally { setSaving(false); }
  }

  return <main className="page">
    <div className="page-head"><div><h1>我的档案</h1><p>维护基本信息与入职附件，工号及任职信息由人事填写。</p></div></div>
    {error && <div className="department-feedback"><p className="form-error" role="alert">{error}</p><button type="button" className="btn secondary" disabled={saving} onClick={() => { setError(""); setReloadKey((current) => current + 1); }}>重新加载</button></div>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {loading ? <p role="status">正在加载档案…</p> : profile && <><ArchivePanel key={`${profile.id}:${profile.departmentId}`} employeeId={profile.id} onLoaded={(archive) => setReadOnly(!archive.canEdit || archive.employmentStatus === "DEPARTED")} />{allowDepartment && !readOnly && <section className="panel employee-profile">
      <h2>部门归属</h2>
      <p className="muted">选择已有部门，保存后直接归入该部门，已分配工号保留原分配部门。</p>
      <form onSubmit={save}><div className="field"><label htmlFor="profile-department">所属部门</label><select id="profile-department" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required disabled={saving}><option value="">请选择所属部门</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div>
        {departments.length === 0 && <p className="muted">当前没有可选部门，请联系管理员。</p>}
        <div className="form-actions"><button className="btn primary" disabled={saving || !departmentId || departmentId === profile.departmentId}>{saving ? "保存中…" : "保存部门归属"}</button></div>
      </form>
    </section>}</>}
  </main>;
}
