import { useEffect, useState, type FormEvent } from "react";

import { apiRequest } from "../../api/client.js";

interface Department { id: string; name: string }

export function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  async function load() {
    const result = await apiRequest<{ departments: Department[] }>("/admin/departments");
    setDepartments(result.departments);
  }
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await apiRequest("/admin/departments", { method: "POST", body: JSON.stringify({ name: String(form.get("name")) }) });
    event.currentTarget.reset();
    await load();
  }
  return <main className="page"><div className="page-head"><div><p className="eyebrow">DEPARTMENTS</p><h1>部门管理</h1><p>维护公司部门结构。</p></div></div><section className="panel"><form className="inline-form" onSubmit={submit}><label className="field"><span>部门名称</span><input name="name" required /></label><button className="btn primary">新增部门</button></form>{departments.map((department) => <p className="order-row" key={department.id}><strong>{department.name}</strong><code>{department.id}</code></p>)}</section></main>;
}
