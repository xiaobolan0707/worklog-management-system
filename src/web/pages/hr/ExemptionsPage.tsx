import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client.js";
import { requestMessage } from "../archives/ArchivePanel.js";
const weekdays = [[1, "周一"], [2, "周二"], [3, "周三"], [4, "周四"], [5, "周五"], [6, "周六"], [0, "周日"]] as const;
export function ExemptionsPage() {
  const [days, setDays] = useState<number[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => { let active = true; setLoaded(false); setError(""); void apiRequest<{ weekdays: number[]; dates: string[] }>("/hr/exemptions").then((result) => { if (active) { setDays(result.weekdays); setDates(result.dates); setLoaded(true); } }).catch((cause) => { if (active) setError(requestMessage(cause, "免交日加载失败")); }); return () => { active = false; }; }, [reload]);
  async function save() { setBusy(true); setError(""); setNotice(""); try { await apiRequest("/hr/exemptions", { method: "PUT", body: JSON.stringify({ weekdays: days, dates }) }); setNotice("免交日已保存"); } catch (cause) { setError(requestMessage(cause, "免交日保存失败")); } finally { setBusy(false); } }
  return <main className="page"><div className="page-head"><div><h1>免交日设置</h1><p>按北京时间生效；免交日不计入应交量或提交率，也不发送日志催交提醒。</p></div></div>{error && <div className="department-feedback"><p role="alert" className="form-error">{error}</p><button className="btn secondary" disabled={busy} onClick={() => setReload((n) => n + 1)}>重新加载</button></div>}{notice && <p role="status" className="notice">{notice}</p>}
    <section className="panel"><fieldset className="settings-reminder-days" disabled={!loaded || busy}><legend>每周免交日</legend><div className="settings-day-options">{weekdays.map(([value, label]) => <label key={value}><input type="checkbox" checked={days.includes(value)} onChange={(event) => setDays((current) => event.target.checked ? [...current, value].sort((a, b) => a - b) : current.filter((day) => day !== value))} /><span>{label}</span></label>)}</div></fieldset>
      <div className="settings-date-add"><label className="field"><span>指定免交日期</span><input type="date" value={date} disabled={!loaded || busy} onChange={(event) => setDate(event.target.value)} /></label><button className="btn secondary" disabled={!loaded || busy || !date || dates.includes(date)} onClick={() => { setDates((current) => [...current, date].sort()); setDate(""); }}>添加日期</button></div>
      {dates.length > 0 && <ul className="settings-excluded-dates" aria-label="指定免交日期列表">{dates.map((value) => <li key={value}><time dateTime={value}>{value}</time><button className="text-button" disabled={busy} aria-label={`移除免交日期 ${value}`} onClick={() => setDates((current) => current.filter((item) => item !== value))}>移除</button></li>)}</ul>}
      <p className="muted">固定星期或指定日期任一命中即免交。既有日志的审批义务仍需完成。</p><button className="btn primary" disabled={!loaded || busy} onClick={() => void save()}>{busy ? "保存中…" : "保存免交日"}</button>
    </section></main>;
}
