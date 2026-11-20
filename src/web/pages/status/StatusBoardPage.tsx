import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { beijingParts } from "../../../shared/beijing-time.js";
import { AsyncState, DataTable, StatGrid, type DataColumn } from "../../components/data/index.js";

interface BoardRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string;
  status: string;
  expected: boolean;
  completed: boolean;
  archived: boolean;
}

interface Board {
  date: string;
  summary: { expected: number; completed: number; missing: number; archived: number };
  rows: BoardRow[];
}

const STATUS_LABEL: Record<string, string> = {
  MISSING: "尚未提交",
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  IN_REVIEW: "待核查",
  RETURNED: "已提交 · 退回待修改",
  ARCHIVED: "已归档"
};

const columns: DataColumn<BoardRow>[] = [
  { key: "number", header: "工号", render: (row) => row.employeeNumber },
  { key: "name", header: "姓名", render: (row) => row.employeeName },
  { key: "dept", header: "部门", render: (row) => row.departmentName },
  {
    key: "completed",
    header: "日志提交状态",
    render: (row) => (
      <span className={`badge ${row.completed ? "badge-green" : "badge-gray"}`}>
        {STATUS_LABEL[row.status] ?? (row.completed ? "已提交" : "尚未提交")}{!row.expected && "（免计应交）"}
      </span>
    )
  },
  {
    key: "archived",
    header: "是否归档",
    render: (row) => (
      <span className={`badge ${row.archived ? "badge-green" : "badge-gray"}`}>{row.archived ? "是" : "否"}</span>
    )
  }
];

export function StatusBoardPage() {
  const [date, setDate] = useState(() => beijingParts(new Date()).date);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    setBoard(null);
    void apiRequest<{ board: Board }>(`/status/board?date=${date}`)
      .then((result) => { if (active) setBoard(result.board); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "全员状态加载失败，请重试"); });
    return () => { active = false; };
  }, [date, reload]);

  const retry = () => setReload((value) => value + 1);
  const today = beijingParts(new Date()).date;

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>全员日志状态</h1><p>按查询日期查看全员当日工作日志的提交与归档情况；归档表示日志已完成核查并归档。</p></div>
        <label className="field" style={{ minWidth: 180 }}><span>查询日期</span>
          <input type="date" max={today} value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} />
        </label>
      </div>

      <AsyncState
        loading={!board && !error}
        error={error}
        loadingText="正在统计全员状态…"
        onRetry={retry}
      >
        {board && (
          <>
            <StatGrid items={[
              { label: "应交员工", value: board.summary.expected, unit: "人" },
              { label: "应交中已提交", value: board.summary.completed, unit: "人", tone: "good" },
              { label: "尚未提交", value: board.summary.missing, unit: "人", tone: "warning" },
              { label: "已归档", value: board.summary.archived, unit: "人" }
            ]} />

            <div style={{ marginTop: 20 }}>
              <DataTable
                columns={columns}
                rows={board.rows}
                rowKey={(row) => row.employeeId}
                loadingText="正在统计全员状态…"
                emptyText="该日没有应交或已提交的日志"
                onRetry={retry}
                caption={`统计日期 ${board.date}`}
              />
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              按北京时间 {board.date} 统计。入职前、离职日起及免交日不计入应交人数。
            </p>
          </>
        )}
      </AsyncState>
    </main>
  );
}
