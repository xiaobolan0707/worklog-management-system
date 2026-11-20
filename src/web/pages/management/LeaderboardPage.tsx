import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { beijingParts } from "../../../shared/beijing-time.js";
import { AsyncState, RankCard, StatGrid } from "../../components/data/index.js";
import "./leaderboard.css";

type PeriodType = "MONTHLY" | "QUARTERLY";

interface Rank {
  employeeId: string;
  employeeName: string;
  count: number;
}

interface Leaderboard {
  start: string;
  end: string;
  metTop5: Rank[];
  unmetTop3: Rank[];
}

interface DaySummary {
  employees: number;
  completed: number;
  missing: number;
  archived: number;
}

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: "MONTHLY", label: "每月" },
  { value: "QUARTERLY", label: "每季度" }
];

function toEntries(rows: Rank[]) {
  return rows.map((row) => ({ id: row.employeeId, name: row.employeeName, value: `${row.count} 次` }));
}

export function LeaderboardPage() {
  const [period, setPeriod] = useState<PeriodType>("MONTHLY");
  const [date, setDate] = useState(() => beijingParts(new Date()).date);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    setBoard(null);
    setDay(null);
    void Promise.all([
      apiRequest<{ leaderboard: Leaderboard }>(`/reports/plan-leaderboard?periodType=${period}&referenceDate=${date}`),
      apiRequest<{ board: { summary: DaySummary } }>(`/status/board?date=${date}`).catch(() => ({ board: null }))
    ])
      .then(([leaderboardResult, statusResult]) => {
        if (!active) return;
        setBoard(leaderboardResult.leaderboard);
        setDay(statusResult.board?.summary ?? null);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "排行榜加载失败，请重试"); });
    return () => { active = false; };
  }, [period, date, reload]);

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>员工排行榜</h1><p>按最终审批人对工作计划的评星统计，延期完成不参与排行；所有人可查看全公司员工名次。</p></div>
      </div>

      <div className="lb-filters">
        <label className="field"><span>排行周期</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value as PeriodType)}>
            {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="field"><span>排行日期</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>

      <AsyncState
        loading={!board && !error}
        error={error}
        loadingText="正在统计排行榜…"
        onRetry={() => setReload((value) => value + 1)}
      />

      {day && (
        <>
          <p className="lb-section-label">当日全员概况</p>
          <StatGrid items={[
            { label: "在册员工", value: day.employees, unit: "人" },
            { label: "已提交", value: day.completed, unit: "人", tone: "good" },
            { label: "尚未提交", value: day.missing, unit: "人", tone: "warning" },
            { label: "已归档", value: day.archived, unit: "人" }
          ]} />
        </>
      )}

      {board && <p className="lb-range">统计时间：{board.start} 至 {board.end} · 本榜基于工作计划评星，与日志核查结果相互独立。</p>}
      {board && (
        <div className="lb-grid">
          <RankCard title="红黑榜 · 前五名" tone="red" entries={toEntries(board.metTop5)} />
          <RankCard title="灰星榜 · 前三名" tone="gray" entries={toEntries(board.unmetTop3)} />
        </div>
      )}
    </main>
  );
}
