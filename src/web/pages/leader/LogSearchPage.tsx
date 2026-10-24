import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";

interface Log {
  id: string;
  employeeName: string;
  workDate: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  status: string;
}

export function LogSearchPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<{ logs: Log[]; total: number }>(`/logs?page=${page}&pageSize=20&search=${encodeURIComponent(search)}`)
      .then((result) => {
        if (active) { setLogs(result.logs); setTotal(result.total); setError(""); }
      })
      .catch(() => { if (active) setError("日志查询失败，请重试"); });
    return () => { active = false; };
  }, [page, search]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(input.trim());
  }

  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">LOG SEARCH</p><h1>日志查询</h1><p>查询授权范围内的员工日志。</p></div></div>
    <section className="panel">
      <form className="search-field" onSubmit={submit}>
        <label className="field"><span>员工或日期</span><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="员工姓名 / 2026-10-10" /></label>
        <button className="btn secondary" type="submit">搜索</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="table-wrap"><table><thead><tr><th>日期</th><th>员工</th><th>状态</th><th>颜色</th><th>操作</th></tr></thead><tbody>
        {logs.map((log) => <tr key={log.id}><td>{log.workDate}</td><td>{log.employeeName}</td><td>{log.status}</td><td><StatusBadge color={log.color} /></td><td><Link className="text-link" to={`/leader/logs/${log.id}`}>查看完整信纸</Link></td></tr>)}
      </tbody></table></div>
      <div className="form-actions">
        <button className="btn secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} 页，共 {total} 条</span>
        <button className="btn secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </section>
  </main>;
}
