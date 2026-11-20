import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { beijingParts } from "../../../shared/beijing-time.js";
import { Icon } from "../../components/Icon.js";
import "./work-plan.css";

interface Plan {
  id: string;
  workDate: string;
  target: string;
  dueAt: string | null;
  status: "DRAFT" | "SUBMITTED" | "RATED";
  rating: "MET" | "DELAYED" | "UNMET" | null;
  note: string | null;
  submittedAt?: string | null;
  ratedAt: string | null;
  ratedBy?: { displayName: string | null; username: string } | null;
}

const RATING_LABEL: Record<string, string> = { MET: "达成", DELAYED: "延期完成", UNMET: "未达成" };
const STATUS_LABEL: Record<Plan["status"], string> = { DRAFT: "草稿", SUBMITTED: "已提交", RATED: "已评星" };
/** 允许提前规划的天数：超出这个窗口的计划不进列表，也不允许新建。 */
const PLAN_AHEAD_DAYS = 30;

function todayInBeijing() {
  return beijingParts(new Date()).date;
}

function daysAgo(days: number) {
  const [year, month, day] = todayInBeijing().split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! - days)).toISOString().slice(0, 10);
}

function daysAhead(days: number) {
  const [year, month, day] = todayInBeijing().split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/** 接口把 Prisma Date 序列化成 ISO 全串，卡片与选中比较统一收敛到 YYYY-MM-DD。 */
function dateOnly(value: string) {
  return value.slice(0, 10);
}

function dotDate(value: string) {
  return dateOnly(value).replaceAll("-", ".");
}

function dateTimeText(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(new Date(value));
}

export function WorkPlanPage() {
  const { user } = useAuth();
  const today = todayInBeijing();
  const maxDate = daysAhead(PLAN_AHEAD_DAYS);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [selectedDate, setSelectedDate] = useState(today);
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState(today);
  const [target, setTarget] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    // 一并取未来 30 天，提前规划的计划才能出现在卡片列表里。
    void apiRequest<{ plans: Plan[] }>(`/plans/mine?from=${daysAgo(60)}&to=${maxDate}`)
      .then((result) => {
        if (!active) return;
        const normalized = result.plans.map((plan) => ({ ...plan, workDate: dateOnly(plan.workDate) }));
        setPlans(normalized);
        // 默认选中今天；今天没有计划时退到最近一条，避免打开就是空白。
        setSelectedDate((current) => {
          if (normalized.some((plan) => plan.workDate === current)) return current;
          return normalized.find((plan) => plan.workDate === today)?.workDate ?? normalized[0]?.workDate ?? today;
        });
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "计划加载失败"); });
    return () => { active = false; };
  }, [today, maxDate, reload]);

  const selected = plans?.find((plan) => plan.workDate === selectedDate) ?? null;
  // 「新建/编辑今日计划」应独立于当前选中的日期：选中历史日期时也必须能创建今天的计划。
  const todayPlan = plans?.find((plan) => plan.workDate === today) ?? null;
  const todayEditable = !todayPlan || todayPlan.status === "DRAFT";
  const editPlan = plans?.find((plan) => plan.workDate === editDate) ?? null;
  const editLocked = Boolean(editPlan && editPlan.status !== "DRAFT");

  function fillFrom(date: string) {
    const source = plans?.find((plan) => plan.workDate === date) ?? null;
    setTarget(source?.status === "DRAFT" ? source.target : "");
    setDueAt(source?.status === "DRAFT" && source.dueAt ? source.dueAt.slice(0, 16) : "");
  }

  function startEdit(plan: Plan | null | undefined, date: string) {
    const source = plan ?? plans?.find((item) => item.workDate === date) ?? null;
    setEditDate(date);
    setTarget(source?.status === "DRAFT" ? source.target : "");
    setDueAt(source?.status === "DRAFT" && source.dueAt ? source.dueAt.slice(0, 16) : "");
    setNotice("");
    setError("");
    setEditing(true);
  }

  /** 今日计划已提交时，从明天起找一个还能编辑的日期，保证「添加计划」永远有落点。 */
  function startNewPlan() {
    let date = daysAhead(1);
    for (let step = 0; step < PLAN_AHEAD_DAYS; step += 1) {
      const existing = plans?.find((plan) => plan.workDate === date);
      if (!existing || existing.status === "DRAFT") break;
      date = daysAhead(step + 2);
    }
    setSelectedDate(date);
    startEdit(null, date);
  }

  function changeEditDate(value: string) {
    if (!value) return;
    setEditDate(value);
    const existing = plans?.find((plan) => plan.workDate === value) ?? null;
    if (existing && existing.status !== "DRAFT") {
      setTarget("");
      setDueAt("");
      setError(`${dotDate(value)} 的计划已提交，不能修改；请选择其他日期。`);
      return;
    }
    setError("");
    fillFrom(value);
  }

  async function persist(submit: boolean) {
    if (!target.trim()) { setError("请先填写工作计划目标"); return; }
    if (editLocked) { setError("该日期的计划已提交，不能修改"); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest<{ plan: Plan }>(`/plans/mine/${editDate}`, {
        method: "PUT",
        body: JSON.stringify({ target: target.trim(), dueAt: dueAt ? new Date(dueAt).toISOString() : null })
      });
      if (submit) {
        await apiRequest<{ plan: Plan }>(`/plans/mine/${editDate}/submit`, { method: "POST" });
        setNotice("计划已提交，等待审批人评星。");
      } else {
        setNotice("草稿已保存。");
      }
      setSelectedDate(editDate);
      setEditing(false);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>工作计划</h1><p>按天填写工作计划，提交后由审批人评星；延期完成不参与排行榜。</p></div>
        {!editing && todayEditable && (
          <button className="btn primary" type="button" onClick={() => { setSelectedDate(today); startEdit(todayPlan, today); }}>
            <Icon name="plus" />{todayPlan ? "编辑今日计划" : "新建今日计划"}
          </button>
        )}
        {!editing && !todayEditable && (
          <div className="wp-add-actions">
            <span className="muted">今日计划已提交</span>
            <button className="btn primary" type="button" onClick={startNewPlan}>
              <Icon name="plus" />添加计划
            </button>
          </div>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!plans && !error && <p role="status">正在加载工作计划…</p>}

      {plans && (
        <section className="panel">
          <div className="wp-head">
            <h2>我的计划</h2>
            <span className="muted">近 60 天与未来 {PLAN_AHEAD_DAYS} 天 · 今天 {today}</span>
          </div>
          {plans.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>还没有工作计划。右上角「新建今日计划」可以开第一条。</p>
          ) : (
            <div className="wp-cards" aria-label="我的计划">
              {plans.slice(0, 10).map((plan) => (
                <button
                  type="button"
                  key={plan.id}
                  className="wp-card"
                  aria-pressed={plan.workDate === selectedDate}
                  onClick={() => { setSelectedDate(plan.workDate); setEditing(false); }}
                >
                  <time dateTime={plan.workDate}>
                    {dotDate(plan.workDate)}
                    {plan.workDate === today ? " · 今天" : plan.workDate > today ? " · 未来" : ""}
                  </time>
                  <p>{plan.target}</p>
                  <span className={`wp-state wp-state-${plan.status.toLowerCase()}`}>{STATUS_LABEL[plan.status]}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {editing && (
        <section className="panel" style={{ marginTop: 20 }}>
          <h2>{editDate === today ? `${editDate} · 填写今日计划` : `${editDate} · 填写计划`}</h2>
          <div className="wp-form">
            <label className="field"><span>计划日期</span>
              <input
                type="date"
                value={editDate}
                min={today}
                max={maxDate}
                onChange={(event) => changeEditDate(event.target.value)}
              />
            </label>
            <p className="muted wp-date-hint">可以提前安排未来 {PLAN_AHEAD_DAYS} 天内的计划；今天之前的日期不能补建。</p>
            <label className="field"><span>工作计划目标（不超过 500 字）</span>
              <textarea value={target} maxLength={500} onChange={(event) => setTarget(event.target.value)} placeholder="例如：完成登录页会话续期联调，补齐 401 与并发退出用例。" />
            </label>
            <label className="field"><span>计划完成时间</span>
              <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <div className="wp-form-actions">
              <button className="btn secondary" type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button>
              <button className="btn secondary" type="button" disabled={busy || editLocked} onClick={() => void persist(false)}>保存草稿</button>
              <button className="btn primary" type="button" disabled={busy || editLocked} onClick={() => void persist(true)}>提交评星</button>
            </div>
          </div>
        </section>
      )}

      {!editing && selected && (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="wp-head">
            <h2>{dotDate(selected.workDate)} · 计划详情</h2>
            <span className={`badge ${selected.status === "RATED" ? "badge-green" : selected.status === "SUBMITTED" ? "badge-wait" : "badge-gray"}`}>
              {STATUS_LABEL[selected.status]}
            </span>
          </div>

          <dl className="wp-fields">
            <div className="wp-field-wide"><dt>工作计划目标</dt><dd>{selected.target}</dd></div>
            <div><dt>计划完成时间</dt><dd>{dateTimeText(selected.dueAt)}</dd></div>
            <div>
              <dt>工作计划评星</dt>
              <dd>
                {selected.rating
                  ? <span className={`badge ${selected.rating === "MET" ? "badge-green" : selected.rating === "DELAYED" ? "badge-wait" : "badge-red"}`}>{RATING_LABEL[selected.rating]}</span>
                  : <span className="muted">{selected.status === "SUBMITTED" ? "等待审批人评星" : "尚未提交"}</span>}
                <span className="wp-hint">本地为三档口径：达成 / 延期完成 / 未达成（延期不参与排行榜）</span>
              </dd>
            </div>
          </dl>

          <p className="wp-submit-note">
            员工姓名：{user?.displayName ?? user?.username ?? "—"}　·　工作计划日期：{selected.workDate}　·　提交时间：{dateTimeText(selected.submittedAt)}
          </p>

          <div className="wp-approval">
            <h3>工作计划评星记录</h3>
            {selected.rating ? (
              <p>
                第 1 级：{selected.ratedBy?.displayName ?? selected.ratedBy?.username ?? "审批人"}
                　<strong>{RATING_LABEL[selected.rating]}</strong>
                <span className="muted">　{dateTimeText(selected.ratedAt)}</span>
              </p>
            ) : (
              <p className="muted">{selected.status === "SUBMITTED" ? "计划已提交，等待审批人评星。" : "草稿尚未提交，不进入评星流程。"}</p>
            )}
            {selected.note && <p className="wp-note">评语：{selected.note}</p>}
          </div>
        </section>
      )}

      {!editing && !selected && plans && plans.length > 0 && (
        <section className="panel" style={{ marginTop: 20 }}>
          <p className="muted">所选日期暂无计划。选择上方卡片查看历史，或右上角「添加计划」新建一条。</p>
        </section>
      )}
    </main>
  );
}
