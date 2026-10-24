import { useEffect, useRef, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { WorkItemEditor, type EditableWorkItem } from "../../components/logs/WorkItemEditor.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { effectiveCharacterCount } from "../../../shared/text.js";
import { beijingParts } from "../../../shared/beijing-time.js";

interface LogView {
  id: string;
  status: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  employeeName: string;
  workDate: string;
  planTarget?: string | null;
  planDueAt?: string | null;
  items: EditableWorkItem[];
}

type WorkPlanView = Pick<LogView, "workDate" | "planTarget" | "planDueAt">;
type LogListView = WorkPlanView & { id: string };

const emptyItem = (): EditableWorkItem => ({ content: "", completed: true, images: [] });

function withFourItems(items: EditableWorkItem[]) {
  return [...items.map((item) => ({ ...item, completed: true, unfinishedReason: undefined, images: item.images ?? [] })), ...Array.from({ length: Math.max(0, 4 - items.length) }, emptyItem)];
}

function todayInBeijing() {
  return beijingParts(new Date()).date;
}

function storageKey(userId: string) {
  return `worklog:today-draft:${userId}:${todayInBeijing()}`;
}

function recentBeijingDates() {
  const [year, month, day] = todayInBeijing().split("-").map(Number);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(year!, month! - 1, day! - 6 + index)).toISOString().slice(0, 10)
  );
}

function toBeijingInput(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value)).replace(" ", "T");
}

function fromBeijingInput(value: string) {
  return value ? new Date(`${value}:00+08:00`).toISOString() : null;
}

function planDueText(value?: string | null) {
  if (!value) return "未填写";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function TodayLogPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<EditableWorkItem[]>(() => withFourItems([]));
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [log, setLog] = useState<LogView | null>(null);
  const [plans, setPlans] = useState<WorkPlanView[]>([]);
  const [planTarget, setPlanTarget] = useState("");
  const [planDueAt, setPlanDueAt] = useState("");
  const [selectedPlanDate, setSelectedPlanDate] = useState(todayInBeijing);
  const workPlanPanel = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user) return;
    try { setItems(withFourItems(JSON.parse(localStorage.getItem(storageKey(user.id)) ?? "null") ?? [])); }
    catch { setItems(withFourItems([])); }
    setLoadedUserId(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    void apiRequest<{ logs: LogListView[] }>("/logs/mine?pageSize=50").then(({ logs }) => {
      const recentDates = new Set(recentBeijingDates());
      setPlans(logs
        .filter((candidate) => recentDates.has(candidate.workDate))
        .map(({ workDate, planTarget, planDueAt }) => ({
          workDate,
          planTarget: planTarget ?? null,
          planDueAt: planDueAt ?? null
        })));
      const current = logs.find((candidate) => candidate.workDate === todayInBeijing());
      if (current) {
        void apiRequest<{ log: LogView }>(`/logs/${current.id}`).then(({ log: fullLog }) => {
          setLog(fullLog);
          setItems(withFourItems(fullLog.items));
          setPlanTarget(fullLog.planTarget ?? "");
          setPlanDueAt(toBeijingInput(fullLog.planDueAt));
        }).catch(() => setError("今日日志加载失败，请刷新重试"));
      }
    }).catch(() => setError("今日日志加载失败，请刷新重试"));
  }, [user?.id]);
  useEffect(() => {
    if (user && loadedUserId === user.id && (!log || ["DRAFT", "RETURNED"].includes(log.status))) {
      try { localStorage.setItem(storageKey(user.id), JSON.stringify(items)); }
      catch { setError("浏览器空间不足，草稿未能在本机缓存，请及时保存到服务器"); }
    }
  }, [items, log, loadedUserId, user?.id]);
  useEffect(() => {
    const panel = workPlanPanel.current;
    if (!panel) return;
    const handleWheel = (event: WheelEvent) => {
      const offset = Math.sign(event.deltaY);
      if (!offset) return;
      const dates = recentBeijingDates();
      const currentIndex = dates.indexOf(selectedPlanDate);
      const nextIndex = Math.max(0, Math.min(dates.length - 1, currentIndex + offset));
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      setSelectedPlanDate(dates[nextIndex]!);
    };
    panel.addEventListener("wheel", handleWheel, { passive: false });
    return () => panel.removeEventListener("wheel", handleWheel);
  }, [selectedPlanDate]);

  function validateForSubmit() {
    if (items.length < 4) return "工作日志至少需要填写 4 项";
    const shortIndex = items.findIndex((item) => effectiveCharacterCount(item.content) < 20);
    if (shortIndex >= 0) return `第 ${shortIndex + 1} 项工作内容至少需要填写 20 字`;
    return "";
  }

  async function saveDraft() {
    setError("");
    const result = await apiRequest<{ log: LogView }>(log ? `/logs/${log.id}` : "/logs/drafts", {
      method: log ? "PUT" : "POST",
      body: JSON.stringify({
        workDate: todayInBeijing(),
        items,
        planTarget: planTarget || null,
        planDueAt: fromBeijingInput(planDueAt)
      })
    });
    setLog(result.log);
    setPlans((current) => [
      {
        workDate: result.log.workDate,
        planTarget: result.log.planTarget ?? null,
        planDueAt: result.log.planDueAt ?? null
      },
      ...current.filter((candidate) => candidate.workDate !== result.log.workDate)
    ]);
    setPlanTarget(result.log.planTarget ?? "");
    setPlanDueAt(toBeijingInput(result.log.planDueAt));
    setNotice("草稿已保存");
    return result.log;
  }

  async function submit() {
    const message = validateForSubmit();
    if (message) { setError(message); return; }
    const draft = await saveDraft();
    if (!draft) return;
    const result = await apiRequest<{ log: LogView }>(`/logs/${draft.id}/submit`, { method: "POST" });
    setLog(result.log);
    setNotice("日志已提交，等待领导核查");
    if (user) localStorage.removeItem(storageKey(user.id));
  }

  const locked = Boolean(log && !["DRAFT", "RETURNED"].includes(log.status));
  const recentDates = recentBeijingDates();
  const selectedPlanIndex = recentDates.indexOf(selectedPlanDate);
  const selectedPlan = selectedPlanDate === todayInBeijing()
    ? { planTarget, planDueAt: fromBeijingInput(planDueAt) }
    : plans.find((candidate) => candidate.workDate === selectedPlanDate);

  function movePlan(offset: -1 | 1) {
    const nextIndex = Math.max(0, Math.min(recentDates.length - 1, selectedPlanIndex + offset));
    if (nextIndex !== selectedPlanIndex) setSelectedPlanDate(recentDates[nextIndex]!);
  }

  return (
    <main className="page">
      <div className="page-head"><div><p className="eyebrow">TODAY · {todayInBeijing()}</p><h1>今日工作日志</h1><p>按 1、2、3… 逐项填写当天工作，完成情况由领导核查。</p></div>{log && <StatusBadge color={log.color} />}</div>
      {notice && <p className="notice success">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="panel form-panel">
        <WorkItemEditor
          items={items}
          onChange={setItems}
          disabled={locked}
          employeeName={log?.employeeName ?? user?.displayName ?? user?.username ?? "—"}
          workDate={log?.workDate ?? todayInBeijing()}
        />
        <section
          ref={workPlanPanel}
          className="work-plan-panel"
          role="region"
          aria-label="最近 7 天工作计划"
          tabIndex={0}
        >
          <div className="work-plan-head">
            <div><p className="eyebrow">RECENT 7 DAYS</p><h2>员工工作计划</h2></div>
            <span>滚动鼠标滚轮切换日期</span>
          </div>
          <div className="work-plan-dates" aria-label="最近七天日期">
            {recentDates.map((date) => (
              <button
                type="button"
                key={date}
                className={date === selectedPlanDate ? "active" : ""}
                aria-label={date === todayInBeijing() ? "查看今天" : `查看 ${date}`}
                aria-pressed={date === selectedPlanDate}
                onClick={() => setSelectedPlanDate(date)}
              >
                <span>{date.slice(5)}</span>
                <small>{date === todayInBeijing() ? "今天" : ""}</small>
              </button>
            ))}
          </div>
          <article className="work-plan-card" aria-live="polite">
            <div className="work-plan-card-head">
              <strong>{selectedPlanDate}</strong>
              <div>
                <button type="button" className="text-button" onClick={() => movePlan(-1)} disabled={selectedPlanIndex === 0}>上一天</button>
                <button type="button" className="text-button" onClick={() => movePlan(1)} disabled={selectedPlanIndex === recentDates.length - 1}>下一天</button>
              </div>
            </div>
            {selectedPlanDate === todayInBeijing() && !locked ? (
              <>
                {!planTarget && !planDueAt && <p className="work-plan-empty">当日暂无工作计划</p>}
                <div className="work-plan-fields">
                  <label className="field"><span>计划完成时间</span><input type="datetime-local" aria-label="计划完成时间" value={planDueAt} onChange={(event) => setPlanDueAt(event.target.value)} /></label>
                  <label className="field"><span>工作计划</span><textarea aria-label="工作计划" maxLength={500} value={planTarget} onChange={(event) => setPlanTarget(event.target.value)} /></label>
                </div>
              </>
            ) : selectedPlan?.planTarget || selectedPlan?.planDueAt ? (
              <div className="work-plan-readonly">
                <p><span>工作计划</span>{selectedPlan.planTarget || "未填写"}</p>
                <p><span>计划完成时间</span>{planDueText(selectedPlan.planDueAt)}</p>
              </div>
            ) : <p className="work-plan-empty">当日暂无工作计划</p>}
          </article>
        </section>
        {!locked && <div className="form-actions"><button className="btn secondary" onClick={() => void saveDraft()}>保存草稿</button><button className="btn primary" onClick={() => void submit()}>提交日志</button></div>}
      </section>
    </main>
  );
}
