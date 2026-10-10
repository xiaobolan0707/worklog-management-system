import { StatusBadge } from "../StatusBadge.js";

export interface ApprovalStepView {
  approverId: string;
  position: number;
  status: string;
  color: "RED" | "GRAY" | null;
  comment: string | null;
}

export function ApprovalProgress({ steps }: { steps: ApprovalStepView[] }) {
  return (
    <div className="approval-progress">
      {steps.map((step) => (
        <article key={`${step.position}-${step.approverId}`}>
          <span className={`step-dot ${step.status.toLowerCase()}`} />
          <div><strong>第 {step.position} 级审批</strong><p>{step.comment || (step.status === "PENDING" ? "等待审批" : "已处理")}</p></div>
          {step.color && <StatusBadge color={step.color} />}
        </article>
      ))}
    </div>
  );
}
