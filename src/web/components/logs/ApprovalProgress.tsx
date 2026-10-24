import { useState, type FormEvent } from "react";
import { StatusBadge } from "../StatusBadge.js";

export interface ApprovalStepView {
  id?: string;
  submissionNumber?: number;
  approverId: string;
  approverName?: string;
  approverRole?: string;
  position: number;
  status: string;
  color: "RED" | "GRAY" | null;
  comment: string | null;
  itemComments?: { itemPosition: number; comment: string }[];
  replies?: { id: string; itemPosition: number; content: string; createdAt: string }[];
  actedAt?: string | null;
}

const roleNames: Record<string, string> = { LEADER: "领导", MANAGEMENT: "管理层", ADMIN: "管理员" };

function actedAtText(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ReplyForm({ stepId, itemPosition, approverName, onReply }: {
  stepId: string; itemPosition: number; approverName: string;
  onReply(stepId: string, itemPosition: number, content: string): Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await onReply(stepId, itemPosition, content.trim());
      setContent("");
      setMessage("回复已发送");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回复发送失败，请重试");
    } finally {
      setSaving(false);
    }
  }
  return <form className="comment-reply-form" onSubmit={(event) => void submit(event)}>
    <label className="field"><span>回复第 {itemPosition} 项工作中{approverName}的批注</span>
      <textarea value={content} maxLength={1000} rows={2} onChange={(event) => setContent(event.target.value)} />
    </label>
    <button className="btn secondary" type="submit" disabled={!content.trim() || saving}>{saving ? "发送中…" : "发送回复"}</button>
    {message && <p role="status" className="comment-reply-status">{message}</p>}
  </form>;
}

export function ItemCommentThread({ steps, itemPosition, onReply }: {
  steps: ApprovalStepView[]; itemPosition: number;
  onReply?: ((stepId: string, itemPosition: number, content: string) => Promise<void>) | undefined;
}) {
  const comments = steps.flatMap((step) => {
    const itemComment = step.itemComments?.find((item) => item.itemPosition === itemPosition);
    return itemComment ? [{ step, comment: itemComment.comment }] : [];
  });
  if (comments.length === 0) return <p className="comment-placeholder">暂无批注</p>;
  return <div className="item-comment-thread">{comments.map(({ step, comment }) => <article className="item-comment" key={step.id ?? `${step.approverId}-${step.position}`}>
    <strong>{step.approverName ?? `第 ${step.position} 级审批人`} · {roleNames[step.approverRole ?? ""] ?? step.approverRole ?? "审批人"}</strong>
    <p>{comment}</p>{step.actedAt && <time dateTime={step.actedAt}>{actedAtText(step.actedAt)}</time>}
    {step.replies?.filter((reply) => reply.itemPosition === itemPosition).map((reply) => <div className="item-comment-reply" key={reply.id}>
      <strong>员工回复</strong><p>{reply.content}</p><time dateTime={reply.createdAt}>{actedAtText(reply.createdAt)}</time>
    </div>)}
    {onReply && step.id && <ReplyForm stepId={step.id} itemPosition={itemPosition} approverName={step.approverName ?? "领导"} onReply={onReply} />}
  </article>)}</div>;
}

export function ApprovalProgress({ steps }: { steps: ApprovalStepView[] }) {
  return <div className="approval-progress">{steps.map((step) => <article key={`${step.position}-${step.approverId}`}><span className={`step-dot ${step.status.toLowerCase()}`} /><div><strong>{step.approverName ?? `第 ${step.position} 级审批`} · {roleNames[step.approverRole ?? ""] ?? step.approverRole ?? "审批人"}</strong><p>{step.status === "PENDING" ? "等待审批" : step.actedAt ? actedAtText(step.actedAt) : "已处理"}</p></div>{step.color && <StatusBadge color={step.color} />}</article>)}</div>;
}
