import type { ArchiveCategory } from "../../generated/prisma/client.js";

export function archiveDeadline(createdAt: Date, activation: Date | null) {
  return new Date(Math.max(createdAt.getTime(), activation?.getTime() ?? 0) + 7 * 86_400_000);
}

const categories = {
  RESUME: "入职简历",
  DEGREE: "学历证明",
  AGREEMENT: "劳动合同／合伙人协议"
} as const;

export function archiveChecklist(employee: {
  displayName: string | null;
  gender: string | null;
  departmentId: string | null;
  hireDate: Date | null;
  employeeNumber: number | null;
  archiveAttachments: readonly { category: ArchiveCategory }[];
}) {
  return {
    fields: [
      { label: "员工姓名", complete: Boolean(employee.displayName?.trim()) },
      { label: "性别", complete: Boolean(employee.gender?.trim()) },
      { label: "所属部门", complete: Boolean(employee.departmentId) },
      { label: "入职日期", complete: Boolean(employee.hireDate) },
      { label: "工号", complete: Boolean(employee.employeeNumber) }
    ],
    documents: Object.entries(categories).map(([category, label]) => ({
      label, submitted: employee.archiveAttachments.some((file) => file.category === category)
    }))
  };
}

export function missingArchiveFields(employee: Parameters<typeof archiveChecklist>[0]) {
  const { fields, documents } = archiveChecklist(employee);
  return [...fields.filter((item) => !item.complete), ...documents.filter((item) => !item.submitted)].map((item) => item.label);
}
