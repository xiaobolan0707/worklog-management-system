import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../../api/client.js";
import { ArchivePanel, requestMessage } from "./ArchivePanel.js";

export function ArchivesPage() {
  const [employees, setEmployees] = useState<{ id: string; displayName: string | null; departmentName: string | null; employeeNumber: number | null; employmentStatus: string }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setError(""); setLoading(true);
    void apiRequest<{ employees: typeof employees }>("/archives").then((result) => { if (active) setEmployees(result.employees); }).catch((cause) => { if (active) setError(requestMessage(cause, "档案列表加载失败")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  return <main className="page"><div className="page-head"><div><h1>员工档案</h1><p>按权限查看员工档案。员工本人维护个人资料与附件。</p></div></div>{error && <div className="department-feedback"><p role="alert" className="form-error">{error}</p><button className="btn secondary" onClick={() => setReload((n) => n + 1)}>重新加载</button></div>}
    <section className="panel table-wrap">{loading ? <p role="status">正在加载档案列表…</p> : employees.length === 0 ? <p className="muted">当前范围内暂无员工档案。</p> : <table><thead><tr><th>姓名</th><th>部门</th><th>工号序号</th><th>任职状态</th><th>操作</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td>{employee.displayName ?? "未填写"}</td><td>{employee.departmentName ?? "未分配"}</td><td>{employee.employeeNumber == null ? "待分配" : String(employee.employeeNumber).padStart(4, "0")}</td><td>{employee.employmentStatus === "DEPARTED" ? "离职" : "在职"}</td><td><Link className="btn secondary" to={`/archives/${employee.id}`}>查看档案</Link></td></tr>)}</tbody></table>}</section></main>;
}

export function ArchiveDetailPage() {
  const { id = "" } = useParams();
  return <main className="page"><div className="page-head"><div><h1>员工档案</h1><p><Link to="/archives">返回档案列表</Link></p></div></div><ArchivePanel employeeId={id} /></main>;
}
