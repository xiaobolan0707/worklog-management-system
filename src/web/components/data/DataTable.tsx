import type { ReactNode } from "react";

import { AsyncState } from "./AsyncState.js";

export interface DataColumn<T> {
  key: string;
  header: string;
  render(row: T): ReactNode;
  className?: string;
}

/**
 * 轻量数据表格：只统一「列定义 + 加载/空/异常状态 + 容器样式」，
 * 不接管分页、排序或业务动作，避免侵入各页面已有逻辑。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = "",
  emptyText = "暂无数据",
  loadingText = "正在加载…",
  onRetry,
  caption
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey(row: T): string;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  loadingText?: string;
  onRetry?(): void;
  caption?: string;
}) {
  return (
    <AsyncState
      loading={loading}
      error={error}
      empty={!loading && !error && rows.length === 0}
      loadingText={loadingText}
      emptyText={emptyText}
      onRetry={onRetry}
    >
      <div className="dv-table-wrap">
        <table className="dv-table">
          {caption && <caption className="dv-caption">{caption}</caption>}
          <thead>
            <tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AsyncState>
  );
}
