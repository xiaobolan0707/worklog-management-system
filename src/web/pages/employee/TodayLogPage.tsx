import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { WorkItemEditor, type EditableWorkItem } from "../../components/logs/WorkItemEditor.js";
import { useAuth } from "../../auth/AuthProvider.js";

interface LogView {
  id: string;
  status: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  employeeName: string;
  workDate: string;
  items: EditableWorkItem[];
}

const storageKey = "worklog:today-draft";
const emptyItem = (): EditableWorkItem => ({ content: "", completed: true, images: [] });

function withFourItems(items: EditableWorkItem[]) {
  return [...items.map((item) => ({ ...item, images: item.images ?? [] })), ...Array.from({ length: Math.max(0, 4 - items.length) }, emptyItem)];
}

function todayInBeijing() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function TodayLogPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<EditableWorkItem[]>(() => {
    try { return withFourItems(JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? []); }
    catch { return withFourItems([]); }
  });
  const [log, setLog] = useState<LogView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void apiRequest<{ logs: LogView[] }>("/logs/mine").then(({ logs }) => {
      const current = logs[0];
      if (current) { setLog(current); setItems(withFourItems(current.items)); }
    });
  }, []);
  useEffect(() => {
    if (!log || ["DRAFT", "RETURNED"].includes(log.status)) localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items, log]);

  function validateForSubmit() {
    const emptyIndex = items.findIndex((item) => !item.content.trim() && item.images.length === 0);
    if (items.length < 4 || emptyIndex >= 0) return `请填写第 ${Math.max(0, emptyIndex) + 1} 项工作内容或图片`;
    if (items.some((item) => !item.completed && !item.unfinishedReason?.trim())) return "请填写未完成原因";
    return "";
  }

  async function saveDraft() {
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
    const message = validateForSubmit();
    if (message) { setError(message); return; }
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
        <WorkItemEditor
          items={items}
          onChange={setItems}
          disabled={locked}
          employeeName={log?.employeeName ?? user?.displayName ?? user?.username ?? "—"}
          workDate={log?.workDate ?? todayInBeijing()}
        />
        {!locked && <div className="form-actions"><button className="btn secondary" onClick={() => void saveDraft()}>保存草稿</button><button className="btn primary" onClick={() => void submit()}>提交日志</button></div>}
      </section>
    </main>
  );
}
