import { useEffect, useState } from "react";

import { ApiError, apiRequest } from "../../api/client.js";

interface ScheduleSettings {
  submissionDeadline: string;
  reminderMinutesBefore: number;
  approvalDeadline: string;
  timezone: "Asia/Shanghai";
  logReminderExcludedWeekdays?: number[];
  logReminderExcludedDates?: string[];
}

const weekdays = [[1, "周一"], [2, "周二"], [3, "周三"], [4, "周四"], [5, "周五"], [6, "周六"], [0, "周日"]] as const;

export function SettingsPage() {
  const [submission, setSubmission] = useState("18:00");
  const [approval, setApproval] = useState("12:00");
  const [minutes, setMinutes] = useState(30);
  const [excludedWeekdays, setExcludedWeekdays] = useState<number[]>([]);
  const [excludedDates, setExcludedDates] = useState<string[]>([]);
  const [dateToAdd, setDateToAdd] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void apiRequest<{ settings: ScheduleSettings }>("/admin/settings")
      .then(({ settings }) => {
        setSubmission(settings.submissionDeadline);
        setMinutes(settings.reminderMinutesBefore);
        setApproval(settings.approvalDeadline);
        setExcludedWeekdays(settings.logReminderExcludedWeekdays ?? []);
        setExcludedDates(settings.logReminderExcludedDates ?? []);
        setLoaded(true);
      })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : "设置加载失败，请刷新重试"));
  }, []);

  async function save() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(submission) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(approval)) {
      setError("时间格式应为 00:00–23:59");
      return;
    }
    setError("");
    setNotice("");
    try {
      await apiRequest("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          submissionDeadline: submission,
          approvalDeadline: approval,
          reminderMinutesBefore: minutes,
          timezone: "Asia/Shanghai",
          logReminderExcludedWeekdays: excludedWeekdays,
          logReminderExcludedDates: excludedDates
        })
      });
      setNotice("设置已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "设置保存失败，请稍后重试");
    }
  }

  return <main className="page">
    <div className="page-head"><div><h1>系统设置</h1><p>统一使用北京时间。</p></div></div>
    <section className="panel settings-grid">
      <label className="field"><span>日志截止时间</span><input value={submission} onChange={(event) => setSubmission(event.target.value)} /></label>
      <label className="field"><span>提前提醒（分钟）</span><input type="number" min={0} max={1440} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
      <fieldset className="settings-reminder-days" disabled={!loaded}>
        <legend>每周免交日</legend>
        <div className="settings-day-options">{weekdays.map(([day, label]) => <label key={day}>
          <input type="checkbox" checked={excludedWeekdays.includes(day)} onChange={(event) => {
            const checked = event.target.checked;
            setExcludedWeekdays((current) => checked ? [...current, day].sort((a, b) => a - b) : current.filter((value) => value !== day));
          }} /><span>{label}</span>
        </label>)}</div>
      </fieldset>
      <div className="settings-date-add">
        <label className="field"><span>指定免交日期</span><input type="date" value={dateToAdd} onChange={(event) => setDateToAdd(event.target.value)} /></label>
        <button type="button" className="btn secondary" disabled={!loaded || !dateToAdd || excludedDates.includes(dateToAdd)} onClick={() => {
          setExcludedDates((current) => [...current, dateToAdd].sort());
          setDateToAdd("");
        }}>添加日期</button>
      </div>
      {excludedDates.length > 0 && <ul className="settings-excluded-dates" aria-label="指定免交日期列表">{excludedDates.map((date) => <li key={date}>
        <time dateTime={date}>{date}</time><button type="button" className="text-button" aria-label={`移除免交日期 ${date}`} onClick={() => setExcludedDates((current) => current.filter((value) => value !== date))}>移除</button>
      </li>)}</ul>}
      <p className="muted settings-hint">按北京时间生效，固定星期和指定日期任一命中即免交，不计入应交量、未提交或逾期，也不发送日志催交提醒；既有日志仍需审批。</p>
      <label className="field"><span>审批逾期提醒时间</span><input value={approval} onChange={(event) => setApproval(event.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="btn primary" disabled={!loaded} onClick={() => void save()}>保存设置</button>
      {notice && <p className="notice">{notice}</p>}
    </section>
  </main>;
}
