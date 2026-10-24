import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { ApprovalProgress, ItemCommentThread, type ApprovalStepView } from "../../components/logs/ApprovalProgress.js";
import { LetterLog, type LetterLogItem } from "../../components/logs/LetterLog.js";

interface LogDetail {
  employeeName: string;
  workDate: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  submissionCount?: number;
  versions?: { position: number; content: string }[][];
  items: (LetterLogItem & { position: number })[];
  approvalSteps: ApprovalStepView[];
}

export function LogDetailPage({ backTo = "/leader/logs" }: { backTo?: string }) {
  const { id = "" } = useParams();
  const location = useLocation();
  const reminderId = (location.state as { reminderId?: string } | null)?.reminderId;
  const readReminderId = useRef<string | null>(null);
  const [log, setLog] = useState<LogDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => {
      void apiRequest<{ log: LogDetail }>(`/logs/${id}`)
        .then((result) => {
          if (!active) return;
          setLog(result.log);
          setError("");
          if (reminderId && readReminderId.current !== reminderId) {
            readReminderId.current = reminderId;
            void apiRequest(`/reminders/${reminderId}/read`, { method: "POST" })
              .then(() => window.dispatchEvent(new Event("reminder-read")))
              .catch(() => { readReminderId.current = null; });
          }
        })
        .catch(() => { if (active) setError("日志加载失败，请刷新重试"); });
    };
    load();
    const interval = window.setInterval(load, 10_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [id, reminderId]);

  async function replyToComment(stepId: string, itemPosition: number, content: string) {
    const result = await apiRequest<{ log: LogDetail }>(`/logs/${id}/replies`, {
      method: "POST", body: JSON.stringify({ stepId, itemPosition, content })
    });
    setLog(result.log);
  }

  if (!log && !error) return <main className="page"><p role="status">正在加载日志…</p></main>;
  const submissionCount = log?.submissionCount ?? 1;
  const latestSnapshot = log?.versions?.[submissionCount - 1];
  const currentItemsMatch = !latestSnapshot || (latestSnapshot.length === log?.items.length &&
    latestSnapshot.every((item, index) => item.position === log?.items[index]?.position && item.content === log?.items[index]?.content));
  const currentSteps = log?.approvalSteps.filter((step) =>
    (step.submissionNumber ?? submissionCount) === submissionCount && currentItemsMatch
  ) ?? [];
  const oldSteps = log?.approvalSteps.filter((step) =>
    (step.submissionNumber ?? submissionCount) < submissionCount || !currentItemsMatch
  ) ?? [];
  const oldSubmissions = [...new Set(oldSteps.map((step) => step.submissionNumber ?? submissionCount))].sort((a, b) => a - b);
  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">LOG DETAIL</p><h1>完整日志</h1><p><Link to={backTo}>返回日志列表</Link></p></div><StatusBadge color={log?.color ?? null} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {log && <section className="panel">
      <LetterLog items={log.items} employeeName={log.employeeName} workDate={log.workDate}
        renderCommentColumn={(item, index) => <ItemCommentThread steps={currentSteps} itemPosition={item.position ?? index + 1}
          onReply={backTo === "/employee/history" ? replyToComment : undefined} />} />
      {oldSubmissions.map((number) => {
        const steps = oldSteps.filter((step) => (step.submissionNumber ?? submissionCount) === number);
        const positions = [...new Set(steps.flatMap((step) => step.itemComments?.map((item) => item.itemPosition) ?? []))].sort((a, b) => a - b);
        return <section className="past-comments" role="region" aria-label={`第 ${number} 次提交的批注与回复`} key={number}>
          <h2>第 {number} 次提交的批注与回复</h2>
          {positions.map((position) => <div className="past-comment-item" key={position}>
            <strong>原第 {position} 项工作</strong>
            <p>{log.versions?.[number - 1]?.find((item) => item.position === position)?.content ?? "原工作内容未保存"}</p>
            <ItemCommentThread steps={steps} itemPosition={position}
              onReply={backTo === "/employee/history" ? replyToComment : undefined} />
          </div>)}
        </section>;
      })}
      <ApprovalProgress steps={log.approvalSteps} />
    </section>}
  </main>;
}
