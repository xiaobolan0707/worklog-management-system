import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { beijingParts } from "../../../shared/beijing-time.js";
import { AsyncState, StatGrid, TrendLine, type TrendPoint } from "../../components/data/index.js";

interface Stats {
  total: number;
  redCount: number;
  grayCount: number;
  returnCount: number;
  onTimeRate: number;
  completionRate: number;
}

/** 最近 count 个月的参考日期，取每月 1 号，避开月末非法日期。 */
function monthDates(year: number, month: number, count: number): string[] {
  const dates: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    dates.push(new Date(Date.UTC(year, month - 1 - index, 1)).toISOString().slice(0, 10));
  }
  return dates;
}

export function EmployeeStatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    setPartial(false);
    setStats(null);
    setTrend([]);
    const today = beijingParts(new Date()).date;
    const [yearValue, monthValue] = today.split("-").map(Number);
    const year = yearValue ?? new Date().getUTCFullYear();
    const month = monthValue ?? 1;
    const dates = monthDates(year, month, 6);

    // 六个月并行取数：任一月失败不拖垮整页，趋势只画取到的月份，避免把缺失画成 0。
    void Promise.allSettled(
      dates.map((date) =>
        apiRequest<{ report: Stats }>(`/reports/employees?periodType=MONTHLY&referenceDate=${date}`)
      )
    )
      .then((results) => {
        if (!active) return;
        const fulfilled = results.filter(
          (result): result is PromiseFulfilledResult<{ report: Stats }> => result.status === "fulfilled"
        );
        if (fulfilled.length === 0) {
          const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
          setError(rejected?.reason instanceof Error ? rejected.reason.message : "我的统计加载失败，请重试");
          return;
        }
        const points: TrendPoint[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            points.push({
              // YY/MM 带年份，跨年时不会把去年 11 月与今年 11 月混在一起。
              label: dates[index]?.slice(2, 7) ?? "",
              value: result.value.report.total
            });
          }
        });
        setTrend(points);
        // 最新一期失败时回退到最近一次成功的数据，并在页面上标注部分缺失。
        const latest = results[results.length - 1];
        setStats(latest?.status === "fulfilled"
          ? latest.value.report
          : fulfilled[fulfilled.length - 1]?.value.report ?? null);
        setPartial(fulfilled.length < results.length);
      });
    return () => { active = false; };
  }, [reload]);

  const current = stats;

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>我的统计</h1><p>仅按完成与未完成统计，不含数字评分。</p></div>
      </div>

      <AsyncState
        loading={!current && !error}
        error={error}
        loadingText="正在统计本月日志…"
        onRetry={() => setReload((value) => value + 1)}
      >
        {current && (
          <>
            <StatGrid columns={3} items={[
              { label: "本月日志", value: current.total, unit: "份" },
              { label: "完成", value: current.redCount, unit: "份", tone: "red" },
              { label: "未完成", value: current.grayCount, unit: "份" },
              { label: "完成率", value: `${current.completionRate}%` },
              { label: "准时提交率", value: `${current.onTimeRate}%`, tone: "good" },
              { label: "退回次数", value: current.returnCount, unit: "次", tone: "warning" }
            ]} />
            {current.total === 0 && <div className="dv-state dv-state-empty" style={{ marginTop: 16 }}>本月暂无日志数据</div>}

            {trend.length > 0 && (
              <section className="panel" style={{ marginTop: 20 }}>
                <h2 style={{ fontSize: 16, marginBottom: 10 }}>近 6 个月日志数</h2>
                <TrendLine points={trend} ariaLabel="近六个月日志数趋势" />
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  按北京时间月份统计；完成率＝完成 ÷（完成＋未完成），无核查结果时显示 0%。
                </p>
                {partial && <p className="muted" style={{ fontSize: 12 }}>部分月份数据未取到，趋势仅展示已获取的月份。</p>}
              </section>
            )}
          </>
        )}
      </AsyncState>
    </main>
  );
}
