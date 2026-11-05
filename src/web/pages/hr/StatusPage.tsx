import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../../api/client.js";
import { requestMessage } from "../archives/ArchivePanel.js";

interface StatusRow { employeeId: string; displayName: string | null; departmentName: string | null; workDate: string; expected: boolean; submissionStatus: "SUBMITTED" | "MISSING" | "OVERDUE"; approvalStatus: "PENDING" | "APPROVED" | "RETURNED" | null; currentApproverName: string | null; approvalOverdue: boolean }
interface StatusData {
  rows: StatusRow[]; employees: { id: string; displayName: string | null; departmentId: string | null }[]; departments: { id: string; name: string }[];
  summary: { expected: number; submitted: number; finalApproved: number; overduePeople: number; submissionRate: number | null; approvalCompletionRate: number | null };
}
export function beijingRange(period: "week" | "month", now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = new Date(`${today}T00:00:00Z`);
  if (period === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  else start.setUTCDate(1);
  return { from: start.toISOString().slice(0, 10), to: today };
}
const percent = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export function HrStatusPage() {
  const [period, setPeriod] = useState("week");
  const [dates, setDates] = useState(() => beijingRange("week"));
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [query, setQuery] = useState(() => new URLSearchParams(beijingRange("week")).toString());
  const [data, setData] = useState<StatusData | null>(null);
  const [filterOptions, setFilterOptions] = useState<Pick<StatusData, "employees" | "departments">>({ employees: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setData(null);
    void apiRequest<StatusData>(`/hr/status?${query}`).then((result) => {
      if (!active) return;
      setData(result);
      const filters = new URLSearchParams(query);
      setFilterOptions((current) => ({ employees: filters.has("employeeId") || filters.has("departmentId") ? current.employees : result.employees, departments: result.departments }));
    }).catch((cause) => { if (active) setError(requestMessage(cause, "台账加载失败，请重试")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, reload]);
  function filter(event: FormEvent) { event.preventDefault(); if (dates.from > dates.to) { setError("开始日期不能晚于结束日期"); return; } setNotice(""); setQuery(new URLSearchParams({ ...dates, ...(employeeId ? { employeeId } : {}), ...(departmentId ? { departmentId } : {}) }).toString()); }
  async function remind(row: StatusRow, kind: "SUBMISSION" | "APPROVAL") {
    setSending(`${row.employeeId}:${row.workDate}:${kind}`); setError(""); setNotice("");
    try { await apiRequest("/hr/reminders", { method: "POST", body: JSON.stringify({ employeeId: row.employeeId, workDate: row.workDate, kind }) }); setNotice(`${row.displayName ?? "员工"} ${row.workDate} 的${kind === "SUBMISSION" ? "催交" : "催审"}提醒已处理，同日重复提醒会自动去重`); }
    catch (cause) { setError(requestMessage(cause, "催办失败，请重试")); } finally { setSending(""); }
  }
  return <main className="page"><div className="page-head"><div><h1>日志状态台账</h1><p>按北京时间监督提交与审批状态；免交日不计入应交量。</p></div>{data && <a className="btn secondary" href={`/api/hr/status/export?${query}`} download>导出状态 CSV</a>}</div>
    <form className="panel hr-filters" onSubmit={filter}><label className="field"><span>日期范围</span><select aria-label="日期范围" value={period} onChange={(event) => { const value = event.target.value; setPeriod(value); if (value === "week" || value === "month") setDates(beijingRange(value)); }}><option value="week">本周</option><option value="month">本月</option><option value="custom">自定义</option></select></label><label className="field"><span>开始日期</span><input type="date" value={dates.from} required onChange={(event) => { setPeriod("custom"); setDates({ ...dates, from: event.target.value }); }} /></label><label className="field"><span>结束日期</span><input type="date" value={dates.to} required onChange={(event) => { setPeriod("custom"); setDates({ ...dates, to: event.target.value }); }} /></label>
      <label className="field"><span>部门</span><select aria-label="部门" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setEmployeeId(""); }}><option value="">全部部门</option>{filterOptions.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label className="field"><span>员工</span><select aria-label="员工" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">全部员工</option>{filterOptions.employees.filter((employee) => !departmentId || employee.departmentId === departmentId).map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName ?? "未填写姓名"}</option>)}</select></label><button className="btn primary" disabled={loading}>查询台账</button></form>
    {error && <div className="department-feedback"><p role="alert" className="form-error">{error}</p><button className="btn secondary" onClick={() => setReload((n) => n + 1)}>重新加载</button></div>}{notice && <p className="notice" role="status">{notice}</p>}
    {loading && <p role="status">正在计算状态台账…</p>}
    {data && <><section className="panel"><h2>区间汇总</h2><dl className="profile-summary archive-summary"><div><dt>应交份数</dt><dd>{data.summary.expected}</dd></div><div><dt>已交份数</dt><dd>{data.summary.submitted}</dd></div><div><dt>提交率</dt><dd>{percent(data.summary.submissionRate)}</dd></div><div><dt>最终通过份数</dt><dd>{data.summary.finalApproved}</dd></div><div><dt>审批完成率</dt><dd>{percent(data.summary.approvalCompletionRate)}</dd></div><div><dt>逾期人数</dt><dd>{data.summary.overduePeople}</dd></div></dl><p className="muted">审批完成以全部审批最终通过为准；待审批、驳回均不计入完成。无应交数据时比例显示“—”。</p></section>
      <section className="panel table-wrap"><h2>状态明细</h2>{data.rows.length === 0 ? <p className="muted">所选区间暂无应交或已交记录，请调整日期或筛选条件。</p> : <table><thead><tr><th>员工</th><th>部门</th><th>工作日期</th><th>提交状态</th><th>审批状态</th><th>当前审批人</th><th>催办</th></tr></thead><tbody>{data.rows.map((row) => <tr key={`${row.employeeId}:${row.workDate}`}><td>{row.displayName ?? "未填写"}</td><td>{row.departmentName ?? "未分配"}</td><td>{row.workDate}</td><td>{{ SUBMITTED: "已提交", MISSING: "未提交", OVERDUE: "逾期未提交" }[row.submissionStatus]}{!row.expected && "（不计应交量）"}</td><td>{row.approvalStatus ? { PENDING: "待审批", APPROVED: "已审批", RETURNED: "驳回" }[row.approvalStatus] : "—"}{row.approvalOverdue && " · 已满72小时"}</td><td>{row.currentApproverName ?? "—"}</td><td>{row.expected && row.submissionStatus !== "SUBMITTED" ? <button className="btn secondary" disabled={!!sending} aria-label={`催交${row.displayName ?? "员工"}${row.workDate}`} onClick={() => void remind(row, "SUBMISSION")}>催交</button> : row.approvalOverdue ? <button className="btn secondary" disabled={!!sending} aria-label={`催审${row.displayName ?? "员工"}${row.workDate}`} onClick={() => void remind(row, "APPROVAL")}>催审</button> : "—"}</td></tr>)}</tbody></table>}</section></>}
  </main>;
}
