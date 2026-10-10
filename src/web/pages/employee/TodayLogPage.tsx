import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { WorkItemEditor, type EditableWorkItem } from "../../components/logs/WorkItemEditor.js";

interface LogView {
  id: string;
  status: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  items: EditableWorkItem[];
}

const storageKey = "worklog:today-draft";

function todayInBeijing() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function TodayLogPage() {
  const [items, setItems] = useState<EditableWorkItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? [{ content: "", completed: true }]; }
    catch { return [{ content: "", completed: true }]; }
  });
  const [log, setLog] = useState<LogView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void apiRequest<{ logs: LogView[] }>("/logs/mine").then(({ logs }) => {
      const current = logs[0];
      if (current) { setLog(current); setItems(current.items); }
    });
  }, []);
  useEffect(() => {
    if (!log || ["DRAFT", "RETURNED"].includes(log.status)) localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items, log]);

  function validate() {
    if (items.some((item) => !item.content.trim())) return "请填写全部工作内容";
    if (items.some((item) => !item.completed && !item.unfinishedReason?.trim())) return "请填写未完成原因";
    return "";
  }

  async function saveDraft() {
    const message = validate();
    if (message) { setError(message); return null; }
    setError("");
    const result = await apiRequest<{ log: LogView }>(log ? `/logs/${log.id}` : "/logs/drafts", {
      method: log ? "PUT" : "POST",
      body: JSON.stringify({ workDate: todayInBeijing(), items })
    });
    setLog(result.log);
    setNotice("草稿已保存");
    return result.log;
  }

  async function submit() {
    const draft = await saveDraft();
    if (!draft) return;
    const result = await apiRequest<{ log: LogView }>(`/logs/${draft.id}/submit`, { method: "POST" });
    setLog(result.log);
    setNotice("日志已提交，等待领导核查");
    localStorage.removeItem(storageKey);
  }

  const locked = Boolean(log && !["DRAFT", "RETURNED"].includes(log.status));
  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">TODAY · {todayInBeijing()}</p><h1>今日工作日志</h1><p>按 1、2、3… 逐项填写当天工作，提交后显示绿色。</p></div>{log && <StatusBadge color={log.color} />}</div>
      {notice && <p className="notice success">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="panel form-panel">
        <WorkItemEditor items={items} onChange={setItems} disabled={locked} />
        {!locked && <div className="form-actions"><button className="btn secondary" onClick={() => void saveDraft()}>保存草稿</button><button className="btn primary" onClick={() => void submit()}>提交日志</button></div>}
      </section>
    </main>
  );
}
