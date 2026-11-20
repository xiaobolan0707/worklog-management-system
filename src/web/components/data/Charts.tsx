import type { StatTone } from "./StatCard.js";

/** 占比横条：数值为 0 或总量为 0 时显示 0%，不画虚假比例。 */
export function BarMeter({
  label,
  value,
  total,
  tone = "default"
}: {
  label: string;
  value: number;
  total: number;
  tone?: StatTone;
}) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="dv-meter">
      <span className="dv-meter-label">{label}</span>
      <div className="dv-meter-track">
        <div className={`dv-meter-fill dv-tone-${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="dv-meter-value">{percent}%</span>
    </div>
  );
}

export interface TrendPoint {
  label: string;
  value: number;
}

/** 自绘 SVG 折线：无图表库依赖，稀疏数据直接标点，颜色跟随主题令牌。 */
export function TrendLine({
  points,
  ariaLabel = "趋势图",
  height = 140
}: {
  points: TrendPoint[];
  ariaLabel?: string;
  height?: number;
}) {
  if (points.length === 0) {
    return <div className="dv-state dv-state-empty">暂无趋势数据</div>;
  }
  const width = 520;
  const left = 28;
  const right = 12;
  const top = 14;
  const bottom = 28;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const x = (index: number) => left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => top + innerHeight - (value / max) * innerHeight;
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(" ");

  return (
    <svg className="dv-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      <line className="dv-gridline" x1={left} y1={top} x2={width - right} y2={top} />
      <line className="dv-gridline" x1={left} y1={top + innerHeight / 2} x2={width - right} y2={top + innerHeight / 2} />
      <line className="dv-axis" x1={left} y1={top + innerHeight} x2={width - right} y2={top + innerHeight} />
      <path className="dv-line" d={line} />
      {points.map((point, index) => (
        <circle className="dv-dot" key={`dot-${point.label}`} cx={x(index)} cy={y(point.value)} r="3" />
      ))}
      {points.map((point, index) => (
        <text key={`label-${point.label}`} x={x(index)} y={height - 8} textAnchor="middle">{point.label}</text>
      ))}
      <text x={2} y={top + 5}>{max}</text>
      <text x={2} y={top + innerHeight + 4}>0</text>
    </svg>
  );
}
