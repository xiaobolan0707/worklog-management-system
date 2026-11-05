import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client.js";
import { ArchivePanel, archiveDate, requestMessage } from "../archives/ArchivePanel.js";
import { LetterLog, type LetterLogItem } from "../../components/logs/LetterLog.js";
import { ApprovalProgress, ItemCommentThread, type ApprovalStepView } from "../../components/logs/ApprovalProgress.js";

interface BinEmployee { id: string; displayName: string | null; departmentName: string | null; recycledAt: string | null; purgeAt: string | null; archivePurgingAt: string | null }
interface BinLog { id: string; employeeName: string; workDate: string; isBackfill: boolean; backfillReason: string | null; planTarget: string | null; planDueAt: string | null; items: LetterLogItem[]; approvalSteps: ApprovalStepView[]; versions: LetterLogItem[][] }
export function RecycleBinPage() {
  const [employees, setEmployees] = useState<BinEmployee[]>([]);
  const [selected, setSelected] = useState<BinEmployee | null>(null);
  const [logs, setLogs] = useState<BinLog[]>([]);
  const [log, setLog] = useState<BinLog | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setError(""); void apiRequest<{ employees: BinEmployee[] }>("/recycle-bin").then((result) => { if (active) setEmployees(result.employees); }).catch((cause) => { if (active) setError(requestMessage(cause, "回收站加载失败")); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [reload]);
  useEffect(() => { setLogs([]); setLog(null); if (!selected) return; let active = true; setLogsLoading(true); void apiRequest<{ logs: BinLog[] }>(`/recycle-bin/${selected.id}/logs`).then((result) => { if (active) setLogs(result.logs); }).catch((cause) => { if (active) setError(requestMessage(cause, "历史日志加载失败")); }).finally(() => { if (active) setLogsLoading(false); }); return () => { active = false; }; }, [selected]);
  async function act(employee: BinEmployee, purge: boolean) {
    const name = employee.displayName ?? "该员工";
    if (!window.confirm(purge ? `确定彻底删除“${name}”的档案、附件及本人历史日志吗？此操作无法恢复。` : `确定恢复“${name}”的历史资料吗？恢复不会自动复职或启用账号。`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(`/recycle-bin/${employee.id}${purge ? "" : "/restore"}`, { method: purge ? "DELETE" : "POST", ...(purge ? { body: JSON.stringify({ confirm: true }) } : {}) }); setSelected(null); setNotice(purge ? `“${name}”的资料已彻底删除` : `“${name}”的历史资料已恢复，账号仍保持原任职与启停状态`); setReload((n) => n + 1); }
    catch (cause) { setError(requestMessage(cause, purge ? "彻底删除失败，请重试" : "恢复失败，请重试")); } finally { setBusy(false); }
  }
  return <main className="page"><div className="page-head"><div><h1>资料回收站</h1><p>资料进入回收站后保留 30 天，届满自动清除。恢复资料不会自动复职或启用账号。</p></div></div>{error && <div className="department-feedback"><p role="alert" className="form-error">{error}</p><button className="btn secondary" disabled={busy} onClick={() => setReload((n) => n + 1)}>重新加载</button></div>}{notice && <p role="status" className="notice">{notice}</p>}
    <section className="panel table-wrap">{loading ? <p role="status">正在加载回收站…</p> : !employees.length ? <p className="muted">回收站暂无资料。</p> : <table><thead><tr><th>姓名</th><th>部门</th><th>进入回收站</th><th>计划清除日期</th><th>操作</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td>{employee.displayName ?? "未填写"}</td><td>{employee.departmentName ?? "未分配"}</td><td>{archiveDate(employee.recycledAt)}</td><td>{archiveDate(employee.purgeAt)}</td><td><div className="form-actions"><button className="btn secondary" disabled={busy} onClick={() => { setSelected(employee); setError(""); }}>查看资料</button><button className="btn secondary" disabled={busy || !!employee.archivePurgingAt} onClick={() => void act(employee, false)}>恢复资料</button><button className="btn secondary danger-action" disabled={busy} onClick={() => void act(employee, true)}>彻底删除</button></div></td></tr>)}</tbody></table>}</section>
    {selected && <><div className="department-heading"><h2>{selected.displayName ?? "员工"}的历史资料</h2><button className="btn secondary" onClick={() => setSelected(null)}>收起资料</button></div><ArchivePanel employeeId={selected.id} recycled />
      <section className="panel"><h2>历史日志</h2>{logsLoading ? <p role="status">正在加载历史日志…</p> : !logs.length ? <p className="muted">该员工没有历史日志。</p> : <div className="archive-log-picker">{logs.map((entry) => <button className="btn secondary" key={entry.id} aria-pressed={log?.id === entry.id} onClick={() => setLog(entry)}>{entry.workDate}{entry.isBackfill ? " · 补写" : ""}</button>)}</div>}
        {log && <div className="archive-historical-log"><h3>{log.workDate} 工作日志</h3>{log.isBackfill && <p>补写原因：{log.backfillReason}</p>}{log.planTarget && <p>工作计划：{log.planTarget} · 截止时间：{archiveDate(log.planDueAt)}</p>}<LetterLog items={log.items} employeeName={log.employeeName} workDate={log.workDate} renderCommentColumn={(item, index) => <ItemCommentThread steps={log.approvalSteps} itemPosition={item.position ?? index + 1} />} /><ApprovalProgress steps={log.approvalSteps} />
          {log.versions.map((items, index) => <details className="archive-log-version" key={index}><summary>第 {index + 1} 次提交内容</summary><LetterLog items={items} employeeName={log.employeeName} workDate={log.workDate} renderCommentColumn={(item, position) => <ItemCommentThread steps={log.approvalSteps.filter((step) => (step.submissionNumber ?? log.versions.length) === index + 1)} itemPosition={item.position ?? position + 1} />} /></details>)}
        </div>}
      </section></>}
  </main>;
}
