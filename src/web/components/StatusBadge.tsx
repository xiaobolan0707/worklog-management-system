export function StatusBadge({ color }: { color: "GREEN" | "RED" | "GRAY" | null }) {
  const labels = { GREEN: "已提交", RED: "已完成", GRAY: "未完成" } as const;
  if (!color) return <span className="badge badge-wait">草稿</span>;
  return <span className={`badge badge-${color.toLowerCase()}`}>{labels[color]}</span>;
}
