import { useState } from "react";

import { apiRequest } from "../../api/client.js";
import { beijingParts } from "../../../shared/beijing-time.js";

interface Decision {
  redCount: number;
  grayCount: number;
  outcome: "REWARD" | "IMPROVEMENT";
}

export function RewardsPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState("");

  async function confirm() {
    setError("");
    setDecision(null);
    const [year, month] = beijingParts(new Date()).date.split("-").map(Number);
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const periodEnd = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
    try {
      const result = await apiRequest<{ decision: Decision }>("/rewards/confirm", {
        method: "POST",
        body: JSON.stringify({ employeeId, periodType: "MONTHLY", periodStart, periodEnd })
      });
      setDecision(result.decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认失败");
    }
  }

  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">REWARD DECISIONS</p><h1>奖惩确认</h1><p>按当月实际红灰日志确认。</p></div></div>
    <section className="panel settings-grid">
      <label className="field"><span>员工 ID</span><input value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} /></label>
      <p>红灰数量由系统根据已审批日志计算。</p>
      <button className="btn primary" disabled={!employeeId} onClick={() => void confirm()}>确认结果</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {decision && <p className="notice">已确认：红色 {decision.redCount} 条，灰色 {decision.grayCount} 条；{decision.outcome === "REWARD" ? "奖励建议" : "改进建议"}</p>}
    </section>
  </main>;
}
