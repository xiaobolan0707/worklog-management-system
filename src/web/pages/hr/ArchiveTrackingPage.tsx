import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../../api/client.js";
import { AsyncState } from "../../components/data/index.js";
import { archiveDate, requestMessage } from "../archives/ArchivePanel.js";

const statuses = { COMPLETE: "已补齐", PENDING: "待补齐", OVERDUE: "逾期待补齐", INACTIVE: "未补齐 · 不可维护" } as const;
const trackingPath = "/hr/archive-tracking";

interface ArchiveSummary {
  id: string;
  displayName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  archiveStatus: keyof typeof statuses;
  archiveDeadline: string;
  canRemindArchive: boolean;
}

interface ArchiveDetail extends ArchiveSummary {
  fields: { label: string; complete: boolean }[];
  documents: { label: string; submitted: boolean }[];
}

function TrackingBadge({ status }: { status: ArchiveSummary["archiveStatus"] }) {
  return <span className={`badge badge-${status === "COMPLETE" ? "green" : status === "OVERDUE" ? "red" : "gray"}`}>{statuses[status]}</span>;
}

function useTracking<T>(path: string) {
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    void apiRequest<T>(path)
      .then((data) => { if (active) setResult(data); })
      .catch((cause) => { if (active) setError(requestMessage(cause, "档案状态加载失败")); });
    return () => { active = false; };
  }, [path, reload]);
  return { result, error, retry: () => setReload((value) => value + 1) };
}

export function ArchiveTrackingPage() {
  const { result, error, retry } = useTracking<{ employees: ArchiveSummary[] }>(trackingPath);
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const employees = result?.employees ?? [];
  const departments = new Map(employees.map((employee) => [employee.departmentId ?? "unassigned", employee.departmentName ?? "未分配部门"]));
  const visible = employees.filter((employee) => (!department || (employee.departmentId ?? "unassigned") === department)
    && (!status || employee.archiveStatus === status));

  return <main className="page">
    <div className="page-head"><div><h1>档案提交跟进</h1><p>选择员工，查看资料补齐情况并发送站内提醒。</p></div></div>
    <AsyncState loading={!result && !error} error={error} onRetry={retry}>
      <section className="panel">
        <div className="department-form-grid">
          <label className="field"><span>筛选部门</span><select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">全部部门</option>{[...departments].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <label className="field"><span>筛选档案状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        {visible.length > 0 ? <div className="table-wrap"><table>
          <thead><tr><th scope="col">员工</th><th scope="col">部门</th><th scope="col">档案状态</th><th scope="col">补齐截止日</th></tr></thead>
          <tbody>{visible.map((employee) => <tr key={employee.id}>
            <td><Link className="btn secondary" to={`${trackingPath}/${encodeURIComponent(employee.id)}`}>{employee.displayName ?? "未填写姓名"}</Link></td>
            <td>{employee.departmentName ?? "未分配"}</td><td><TrackingBadge status={employee.archiveStatus} /></td>
            <td>{archiveDate(employee.archiveDeadline)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="muted">没有符合条件的员工。</p>}
      </section>
    </AsyncState>
  </main>;
}

export function ArchiveTrackingDetailRoute() {
  const { id } = useParams();
  return <ArchiveTrackingDetail key={id} id={id!} />;
}

function ArchiveTrackingDetail({ id }: { id: string }) {
  const { result, error, retry } = useTracking<{ employee: ArchiveDetail }>(`${trackingPath}/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reminderError, setReminderError] = useState("");
  const employee = result?.employee;

  async function remind() {
    setBusy(true); setNotice(""); setReminderError("");
    try {
      const { sent } = await apiRequest<{ sent: boolean }>(`/hr/personnel/${encodeURIComponent(id)}/archive-reminder`, { method: "POST" });
      setNotice(sent ? "已发送档案补齐提醒。" : "今天已发送过档案补齐提醒。");
    } catch (cause) {
      setReminderError(requestMessage(cause, "档案补齐提醒发送失败"));
      retry();
    } finally { setBusy(false); }
  }

  return <main className="page">
    <div className="page-head">
      <div><Link to={trackingPath}>返回档案提交跟进</Link><h1>{employee ? `${employee.displayName ?? "未填写姓名"}的档案状态` : "员工档案状态"}</h1></div>
      {employee?.canRemindArchive && <button type="button" className="btn primary" disabled={busy || !!notice} onClick={() => void remind()}>{busy ? "发送中…" : "提醒补齐"}</button>}
    </div>
    {notice && <p role="status" className="notice">{notice}</p>}
    {reminderError && <p role="alert" className="form-error">{reminderError}</p>}
    <AsyncState loading={!result && !error} error={error} onRetry={retry}>
      {employee && <div className="archive-content">
        <section className="panel"><div className="department-heading"><h2>补齐进度</h2><TrackingBadge status={employee.archiveStatus} /></div>
          <dl className="profile-summary"><div><dt>部门</dt><dd>{employee.departmentName ?? "未分配"}</dd></div><div><dt>补齐截止日</dt><dd>{archiveDate(employee.archiveDeadline)}</dd></div></dl>
        </section>
        <section className="panel"><h2>附件提交状态</h2>
          <dl className="profile-summary">{employee.documents.map(({ label, submitted }) => <div key={label}>
            <dt>{label}</dt><dd><span className={`badge badge-${submitted ? "green" : "gray"}`}>{submitted ? "已提交" : "未提交"}</span></dd>
          </div>)}</dl>
        </section>
        <section className="panel"><h2>基本资料补齐状态</h2>
          <dl className="profile-summary">{employee.fields.map(({ label, complete }) => <div key={label}>
            <dt>{label}</dt><dd><span className={`badge badge-${complete ? "green" : "gray"}`}>{complete ? "已填写" : "未填写"}</span></dd>
          </div>)}</dl>
        </section>
      </div>}
    </AsyncState>
  </main>;
}
