import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { beijingParts } from "../../../shared/beijing-time.js";
import {
  AsyncState, BarMeter, DataTable, StatGrid, TrendLine,
  type DataColumn, type StatTone, type TrendPoint
} from "../../components/data/index.js";
import { Segmented } from "../../components/motion/index.js";
import "./dashboard.css";

type PeriodType = "MONTHLY" | "QUARTERLY" | "YEARLY";

interface Report {
  start: string;
  end: string;
  total: number;
  redCount: number;
  grayCount: number;
  returnCount: number;
  onTimeRate: number;
  completionRate: number;
}

interface Reminder {
  id: string;
  title: string;
  body: string;
  readAt?: string | null;
}

interface Point {
  label: string;
  report: Report;
}

interface BreakdownRow {
  label: string;
  value: number;
  note: string;
}

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: "MONTHLY", label: "本月" },
  { value: "QUARTERLY", label: "本季" },
  { value: "YEARLY", label: "本年" }
];

/** 最近 count 个周期的参考日期，统一取周期首月 1 号，避开月末日期非法的问题。 */
function referenceDates(type: PeriodType, year: number, month: number, count: number): string[] {
  const step = type === "YEARLY" ? 12 : type === "QUARTERLY" ? 3 : 1;
  const dates: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    dates.push(new Date(Date.UTC(year, month - 1 - index * step, 1)).toISOString().slice(0, 10));
  }
  return dates;
}

function pointLabel(date: string, type: PeriodType): string {
  const [year, month] = date.split("-").map(Number);
  if (!year || !month) return date;
  const shortYear = String(year).slice(2);
  if (type === "YEARLY") return String(year);
  if (type === "QUARTERLY") return `${shortYear} Q${Math.floor((month - 1) / 3) + 1}`;
  // 带年份，避免近 6 期跨年时仅显示月份造成歧义。
  return `${shortYear}/${String(month).padStart(2, "0")}`;
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function delta(current: number, previous: number): { text: string; down: boolean } {
  if (previous === 0) return { text: current === 0 ? "暂无数据" : "新增", down: false };
  const change = Math.round(((current - previous) / previous) * 100);
  return { text: `${change >= 0 ? "+" : ""}${change}% 较上期`, down: change < 0 };
}

export function DashboardPage() {
  const { user } = useAuth();
  // 领导的统计口径是审批授权范围内的员工，不是全公司；文案必须说清，避免误读。
  const scoped = user?.role === "LEADER";
  const scopeLabel = scoped ? "所辖员工" : "全公司";
  const [period, setPeriod] = useState<PeriodType>("MONTHLY");
  const [points, setPoints] = useState<Point[] | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    setPoints(null);
    const today = beijingParts(new Date()).date;
    const [yearValue, monthValue] = today.split("-").map(Number);
    const year = yearValue ?? new Date().getUTCFullYear();
    const month = monthValue ?? 1;
    const dates = referenceDates(period, year, month, 6);

    void Promise.all([
      Promise.all(
        dates.map((date) =>
          apiRequest<{ report: Report }>(`/reports/company?periodType=${period}&referenceDate=${date}`)
        )
      ),
      apiRequest<{ reminders: Reminder[] }>("/reminders").catch(() => ({ reminders: [] as Reminder[] }))
    ])
      .then(([reports, reminderResult]) => {
        if (!active) return;
        setPoints(reports.map((result, index) => ({ label: pointLabel(dates[index] ?? "", period), report: result.report })));
        setReminders(Array.isArray(reminderResult.reminders) ? reminderResult.reminders : []);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "公司总览加载失败，请重试");
      });

    return () => { active = false; };
  }, [period, reload]);

  const current = points?.[points.length - 1]?.report;
  const previous = points?.[points.length - 2]?.report;
  const total = current?.total ?? 0;
  const red = current?.redCount ?? 0;
  const gray = current?.grayCount ?? 0;
  const decided = red + gray;
  const pending = Math.max(0, total - decided);
  const change = delta(total, previous?.total ?? 0);

  const trend: TrendPoint[] = (points ?? []).map((point) => ({ label: point.label, value: point.report.total }));
  const meters: { label: string; value: number; tone: StatTone }[] = [
    { label: "完成", value: red, tone: "red" },
    { label: "未完成", value: gray, tone: "default" },
    { label: "待核查", value: pending, tone: "warning" }
  ];
  const breakdown: BreakdownRow[] = [
    { label: "完成", value: red, note: "领导核查后定为完成" },
    { label: "未完成", value: gray, note: "领导核查后定为未完成" },
    { label: "待核查", value: pending, note: "尚未完成核查或退回重提" }
  ];
  const breakdownColumns: DataColumn<BreakdownRow>[] = [
    { key: "label", header: "状态", render: (row) => row.label },
    { key: "value", header: "数量", className: "num", render: (row) => row.value },
    { key: "percent", header: "占比", className: "num", render: (row) => `${percent(row.value, total)}%` },
    { key: "note", header: "说明", render: (row) => row.note }
  ];

  const brief = total === 0
    ? "所选周期暂无日志数据，可切换周期或稍后再看。"
    : `本期共 ${total} 份日志，已核查 ${decided} 份；完成 ${red} 份，完成率 ${current?.completionRate ?? 0}%，退回 ${current?.returnCount ?? 0} 次。`;
  const warn = pending > 0 || (current?.returnCount ?? 0) > 0;
  const retry = () => setReload((value) => value + 1);

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>公司总览</h1><p>{scoped ? "查看所辖员工的完成情况与近期趋势（按审批授权范围统计）。" : "查看全公司完成情况与近期趋势。"}</p></div>
        {/* Motion Prompt #060：指示块 250ms 对称滑动，替换原先"按钮换底色"。 */}
        <Segmented
          ariaLabel="统计周期"
          options={PERIODS.map((option) => ({ value: option.value, label: option.label }))}
          value={period}
          onChange={(next) => setPeriod(next as PeriodType)}
        />
      </div>

      <AsyncState
        loading={!points && !error}
        error={error}
        loadingText="正在汇总公司日志数据…"
        onRetry={retry}
      />

      {current && points && (
        <>
          <div className="ov-grid">
            <section className="ov-hero" aria-label="本期概览">
              <div className="ov-eyebrow">本期累计 · {scopeLabel} · 按北京时间统计</div>
              <div className="ov-hero-row">
                <span className="ov-value">{total}</span>
                <span className="ov-unit">份日志</span>
                <span className={`ov-delta${change.down ? " down" : ""}`}>{change.text}</span>
              </div>
              <p className="ov-range">统计区间 {current.start} 至 {current.end}</p>
              <TrendLine points={trend} ariaLabel="最近六个周期日志总数趋势" />
              <div className="ov-bars" aria-label="本期结果构成">
                {meters.map((meter) => (
                  <BarMeter key={meter.label} label={meter.label} value={meter.value} total={total} tone={meter.tone} />
                ))}
              </div>
            </section>

            <aside className="ov-side" aria-label="关键指标">
              <div className="ov-side-item"><span>准时提交率</span><strong>{current.onTimeRate}%</strong></div>
              <div className="ov-side-item"><span>完成率</span><strong>{current.completionRate}%</strong></div>
              <div className="ov-side-item"><span>退回次数</span><strong>{current.returnCount}</strong></div>
              <div className="ov-side-item ov-side-note">
                <h2>站内提醒</h2>
                {reminders.length === 0
                  ? <p>当前没有新提醒。</p>
                  : <><p>共 {reminders.length} 条提醒，最近 {Math.min(2, reminders.length)} 条：</p><ul>{reminders.slice(0, 2).map((reminder) => <li key={reminder.id}>{reminder.title}</li>)}</ul></>}
              </div>
            </aside>
          </div>

          <p className="ov-section-label">下排指标</p>
          <StatGrid items={[
            { label: "日志总数", value: total, unit: "份" },
            { label: "完成", value: red, unit: "份", tone: "red" },
            { label: "未完成", value: gray, unit: "份" },
            { label: "待核查", value: pending, unit: "份", tone: "warning" }
          ]} />

          <p className="ov-section-label">本期构成明细</p>
          <div className={`ov-brief${warn ? " warn" : ""}`} role="status"><strong>一屏先看结论：</strong>{brief}</div>
          <DataTable
            columns={breakdownColumns}
            rows={breakdown}
            rowKey={(row) => row.label}
            loadingText="正在汇总构成明细…"
            emptyText="本期暂无构成数据"
            onRetry={retry}
            caption={`统计区间 ${current.start} 至 ${current.end}`}
          />
        </>
      )}
    </main>
  );
}
