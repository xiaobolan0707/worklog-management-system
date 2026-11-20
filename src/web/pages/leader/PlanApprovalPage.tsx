import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";

interface PendingPlan {
  id: string;
  workDate: string;
  target: string;
  dueAt: string | null;
  submittedAt: string | null;
  employee: { displayName: string | null; username: string; department: { name: string } | null };
}

const RATINGS: { value: "MET" | "DELAYED" | "UNMET"; label: string; className: string }[] = [
  { value: "MET", label: "达成", className: "btn primary" },
  { value: "DELAYED", label: "延期完成", className: "btn secondary" },
  { value: "UNMET", label: "未达成", className: "btn danger" }
];

/** PERF-03：计划队列分页，避免全公司范围一次渲染上百张卡片。 */
const PAGE_SIZE = 10;
/** 提交后超过该天数仍未评星即视为逾期。 */
const OVERDUE_DAYS = 7;

function daysWaiting(submittedAt: string | null) {
  if (!submittedAt) return 0;
  const submitted = new Date(submittedAt).getTime();
  if (!Number.isFinite(submitted)) return 0;
  return Math.max(0, Math.floor((Date.now() - submitted) / 86_400_000));
}

export function PlanApprovalPage() {
  const [plans, setPlans] = useState<PendingPlan[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** 评完当前页最后一条后触发重取，避免停在与总数矛盾的空态。 */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void apiRequest<{ plans: PendingPlan[]; total: number }>(`/plans/pending?page=${page}&pageSize=${PAGE_SIZE}`)
      .then((result) => {
        if (!active) return;
        setPlans(result.plans);
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setPlans([]);
        setTotal(0);
        setError(cause instanceof Error ? cause.message : "待评计划加载失败，请刷新重试");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, reloadKey]);

  const rate = useCallback(async (plan: PendingPlan, rating: "MET" | "DELAYED" | "UNMET") => {
    setBusy(plan.id);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/plans/${plan.id}/rate`, {
        method: "POST",
        body: JSON.stringify({ rating, ...(notes[plan.id]?.trim() ? { note: notes[plan.id]!.trim() } : {}) })
      });
      const remaining = (plans ?? []).filter((item) => item.id !== plan.id);
      setPlans(remaining);
      setTotal(Math.max(0, total - 1));
      setNotice(`${plan.employee.displayName ?? plan.employee.username} ${plan.workDate.slice(0, 10)} 的计划已评星。`);
      // 当前页已空：有上一页就回退，否则立即重取，避免「共 N 条待评」却显示当前没有待评计划。
      if (remaining.length === 0) {
        if (page > 1) setPage(page - 1);
        else setReloadKey((value) => value + 1);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "评星失败，请重试");
    } finally {
      setBusy("");
    }
  }, [notes, plans, total, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>待评计划</h1><p>按员工提交的工作计划评星：达成计入红榜，未达成计入灰榜，延期完成不参与排行。</p></div>
        {!loading && !error && total > 0 && <span className="pending-count">共 {total} 条待评</span>}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {loading && <p role="status">正在加载待评计划…</p>}
      {!loading && !error && plans && plans.length === 0 && <p className="muted">当前没有待评计划。</p>}

      <div style={{ display: "grid", gap: 16 }}>
        {!loading && plans?.map((plan) => {
          const waiting = daysWaiting(plan.submittedAt);
          const overdue = waiting > OVERDUE_DAYS;
          return (
            <article className="panel" key={plan.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="dept-chip">{plan.employee.department?.name ?? "未分配部门"}</span>
                    {plan.employee.displayName ?? plan.employee.username}
                    {overdue && <span className="overdue-tag">逾期 {waiting - OVERDUE_DAYS} 天</span>}
                  </h2>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    计划日期 {plan.workDate.slice(0, 10)}
                    {plan.submittedAt ? ` · 提交于 ${new Date(plan.submittedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}
                    {waiting > 0 ? ` · 已等待 ${waiting} 天` : ""}
                  </p>
                </div>
                {plan.dueAt && <span className="badge badge-wait">截止 {new Date(plan.dueAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              <p style={{ margin: "14px 0", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{plan.target}</p>
              <label className="field"><span>评语（可选）</span>
                <input value={notes[plan.id] ?? ""} maxLength={500} onChange={(event) => setNotes((current) => ({ ...current, [plan.id]: event.target.value }))} placeholder="例如：按期完成，质量稳定。" />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                {RATINGS.map((rating) => (
                  <button key={rating.value} className={rating.className} type="button" disabled={busy === plan.id} onClick={() => void rate(plan, rating.value)}>{rating.label}</button>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {!loading && !error && total > 0 && totalPages > 1 && <div className="form-actions pager">
        <button className="btn secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} / {totalPages} 页</span>
        <button className="btn secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
      </div>}
    </main>
  );
}
