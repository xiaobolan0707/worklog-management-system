import { StatusBadge } from "../StatusBadge.js";

export interface ApprovalStepView {
  approverId: string;
  approverName?: string;
  approverRole?: string;
  position: number;
  status: string;
  color: "RED" | "GRAY" | null;
  comment: string | null;
  itemComments?: { itemPosition: number; comment: string }[];
  actedAt?: string | null;
}

const roleNames: Record<string, string> = { LEADER: "领导", MANAGEMENT: "管理层", ADMIN: "管理员" };

function actedAtText(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ItemCommentThread({ steps, itemPosition }: { steps: ApprovalStepView[]; itemPosition: number }) {
  const comments = steps.flatMap((step) => {
    const itemComment = step.itemComments?.find((item) => item.itemPosition === itemPosition);
    return itemComment ? [{ step, comment: itemComment.comment }] : [];
  });
  if (comments.length === 0) return <p className="comment-placeholder">暂无批注</p>;
  return <div className="item-comment-thread">{comments.map(({ step, comment }) => <article className="item-comment" key={`${step.approverId}-${step.position}`}><strong>{step.approverName ?? `第 ${step.position} 级审批人`} · {roleNames[step.approverRole ?? ""] ?? step.approverRole ?? "审批人"}</strong><p>{comment}</p>{step.actedAt && <time dateTime={step.actedAt}>{actedAtText(step.actedAt)}</time>}</article>)}</div>;
}

export function ApprovalProgress({ steps }: { steps: ApprovalStepView[] }) {
  return <div className="approval-progress">{steps.map((step) => <article key={`${step.position}-${step.approverId}`}><span className={`step-dot ${step.status.toLowerCase()}`} /><div><strong>{step.approverName ?? `第 ${step.position} 级审批`} · {roleNames[step.approverRole ?? ""] ?? step.approverRole ?? "审批人"}</strong><p>{step.status === "PENDING" ? "等待审批" : step.actedAt ? actedAtText(step.actedAt) : "已处理"}</p></div>{step.color && <StatusBadge color={step.color} />}</article>)}</div>;
}
