import type { ReactNode } from "react";
import { Skeleton, EmptyState } from "../motion/index.js";

/**
 * 统一异步状态：加载 / 异常（可重试） / 空数据。
 * 页面只需把三种状态传进来，不再各自重复写 <p role="status"> 与 form-error 块。
 */
export function AsyncState({
  loading = false,
  error = "",
  empty = false,
  loadingText = "正在加载…",
  emptyText = "暂无数据",
  onRetry,
  children
}: {
  loading?: boolean;
  error?: string;
  empty?: boolean;
  loadingText?: string;
  emptyText?: string;
  onRetry?: (() => void) | undefined;
  children?: ReactNode;
}) {
  if (loading) {
    // Motion Prompt #069：同尺寸占位块 + 0.9s 光带，加载完不跳版。
    return <Skeleton rows={3} label={loadingText} />;
  }
  if (error) {
    return (
      <div className="dv-state dv-state-error" role="alert">
        <span>{error}</span>
        {onRetry && <button className="btn secondary" type="button" onClick={onRetry}>重新加载</button>}
      </div>
    );
  }
  if (empty) {
    // Motion Prompt #072：空态淡入并上升 8px，告诉用户"下一步做什么"。
    return <EmptyState title={emptyText} hint="调整筛选条件，或新建一条记录后再回来看看。" />;
  }
  return <>{children}</>;
}
