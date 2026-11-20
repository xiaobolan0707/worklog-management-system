import type { ReactNode } from "react";

/** 统计卡统一语义色：默认主色、good 正常、red 警示、warning 待处理。 */
export type StatTone = "default" | "good" | "red" | "warning";

export interface StatItem {
  label: string;
  value: number | string;
  unit?: string;
  tone?: StatTone;
  hint?: string;
  /** 卡内自定义附加内容（如环比胶囊），位于数值右侧。 */
  extra?: ReactNode;
}

export function StatCard({ item }: { item: StatItem }) {
  const tone = item.tone ?? "default";
  return (
    <div className={`dv-stat dv-tone-${tone}`}>
      <div className="dv-stat-label">{item.label}</div>
      <div className="dv-stat-row">
        <strong className="dv-stat-value">{item.value}</strong>
        {item.unit && <span className="dv-stat-unit">{item.unit}</span>}
        {item.extra}
      </div>
      {item.hint && <div className="dv-stat-hint">{item.hint}</div>}
    </div>
  );
}

/** 统一统计卡网格：桌面 4 列，窄屏自动降为 2 列 / 1 列。 */
export function StatGrid({
  items,
  columns = 4,
  className = ""
}: {
  items: StatItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={`dv-grid dv-cols-${columns} ${className}`.trim()} role="group" aria-label="统计指标">
      {items.map((item, index) => <StatCard key={`${item.label}-${index}`} item={item} />)}
    </div>
  );
}
