import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";

interface HistoryLog {
  id: string;
  workDate: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  status: string;
}

export function HistoryPage() {
  const [logs, setLogs] = useState<HistoryLog[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => {
      void apiRequest<{ logs: HistoryLog[]; total: number }>(`/logs/mine?page=${page}&pageSize=20`)
        .then((result) => {
          if (active) { setLogs(result.logs); setTotal(result.total); setError(""); }
        })
        .catch(() => { if (active) setError("历史日志加载失败，请刷新重试"); });
    };
    load();
    window.addEventListener("focus", load);
    const interval = window.setInterval(load, 10_000);
    return () => { active = false; window.removeEventListener("focus", load); window.clearInterval(interval); };
  }, [page]);

  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">HISTORY</p><h1>历史日志</h1><p>打开日志查看完整工作内容和最新逐项批注。</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="history-list">
      {logs.length === 0 && !error ? <section className="panel empty"><strong>暂无历史日志</strong></section> : logs.map((log) =>
        <section className="panel history-card" key={log.id}>
          <div className="history-status"><strong>{log.workDate}</strong><StatusBadge color={log.color} /></div>
          <p>{log.status}</p>
          <Link className="text-link" to={`/employee/logs/${log.id}`}>查看完整日志与批注</Link>
        </section>
      )}
    </div>
    <div className="form-actions">
      <button className="btn secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button>
      <span>第 {page} 页，共 {total} 条</span>
      <button className="btn secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button>
    </div>
  </main>;
}
