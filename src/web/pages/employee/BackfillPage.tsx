import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiRequest } from "../../api/client.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { WorkItemEditor, type EditableWorkItem } from "../../components/logs/WorkItemEditor.js";
import { beijingParts } from "../../../shared/beijing-time.js";
import { effectiveCharacterCount } from "../../../shared/text.js";

const emptyItem = (): EditableWorkItem => ({ content: "", completed: true, images: [] });

export function BackfillPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workDate, setWorkDate] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<EditableWorkItem[]>(() => Array.from({ length: 4 }, emptyItem));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const today = beijingParts(new Date()).date;
  const [year, month, day] = today.split("-").map(Number);
  const earliest = new Date(Date.UTC(year!, month! - 1, day! - 29)).toISOString().slice(0, 10);

  async function submit() {
    if (!workDate || workDate < earliest || workDate > today) { setError("补写日期超出最近30天，不可补写"); return; }
    if (!reason.trim() || reason.trim().length > 100) { setError("补写原因必填且不超过100字"); return; }
    if (items.some((item) => effectiveCharacterCount(item.content) < 20)) { setError("每项工作内容至少需要填写20字"); return; }
    setBusy(true);
    setError("");
    try {
      const { logs } = await apiRequest<{ logs: { id: string; workDate: string; status: string }[] }>(`/logs/mine?search=${workDate}`);
      const existing = logs.find((log) => log.workDate === workDate);
      if (existing && existing.status !== "DRAFT") { setError("该日期已有日志，请勿重复补写"); return; }
      const { log } = await apiRequest<{ log: { id: string } }>(existing ? `/logs/${existing.id}` : "/logs/drafts", {
        method: existing ? "PUT" : "POST", body: JSON.stringify({ workDate, items })
      });
      await apiRequest(`/logs/${log.id}/submit`, {
        method: "POST", body: JSON.stringify({ backfillReason: reason.trim() })
      });
      navigate(`/employee/logs/${log.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "补写提交失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return <main className="page">
    <div className="page-head"><div><h1>补写日志</h1><p>选择最近30天内的工作日期，提交后进入正常审批。</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="panel form-panel">
      <label className="field"><span>补写日期</span><input type="date" min={earliest} max={today} value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label>
      <label className="field"><span>补写原因</span><textarea maxLength={100} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <WorkItemEditor items={items} onChange={setItems} employeeName={user?.displayName ?? user?.username ?? "—"} workDate={workDate || "—"} />
      <div className="form-actions"><button className="btn primary" disabled={busy} onClick={() => void submit()}>{busy ? "提交中…" : "提交补写日志"}</button></div>
    </section>
  </main>;
}
