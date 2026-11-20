import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface LetterImage {
  id: string;
  name: string;
  type: "image/jpeg" | "image/png" | "image/webp";
  size: number;
  /** 内联 base64；编辑态与单篇详情仍使用该字段。 */
  dataUrl?: string | undefined;
  /** 按需加载地址；待审列表只下发该地址，避免响应体内联大量 base64。 */
  url?: string | undefined;
}

export interface LetterLogItem {
  position?: number;
  content: string;
  completed: boolean;
  unfinishedReason?: string | null | undefined;
  images?: LetterImage[] | undefined;
}

/** 页面内放大预览：不新开标签，点击遮罩、关闭按钮或按 Esc 退出。 */
export function LetterImages({ images = [] }: { images?: LetterImage[] | undefined }) {
  const [preview, setPreview] = useState<{ source: string; name: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setPreview(null);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!preview) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [preview, close]);

  if (images.length === 0) return null;
  return (
    <>
      <div className="letter-images">
        {images.map((image) => {
          const source = image.url ?? image.dataUrl;
          if (!source) return null;
          return (
            <button
              type="button"
              className="letter-image-button"
              onClick={(event) => { openerRef.current = event.currentTarget; setPreview({ source, name: image.name }); }}
              aria-label={`放大查看：${image.name}`}
              key={image.id}
            >
              <img src={source} alt={image.name} loading="lazy" decoding="async" />
            </button>
          );
        })}
      </div>
      {preview && (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`查看原图：${preview.name}`} onClick={close}>
          <figure onClick={(event) => event.stopPropagation()}>
            <img src={preview.source} alt={preview.name} />
            <figcaption>{preview.name}</figcaption>
          </figure>
          <button ref={closeRef} type="button" className="image-lightbox-close" onClick={close} aria-label="关闭预览">×</button>
        </div>
      )}
    </>
  );
}

export function LetterLog({
  items,
  employeeName,
  workDate,
  renderItem,
  renderCommentColumn
}: {
  items: LetterLogItem[];
  employeeName: string;
  workDate: string;
  renderItem?(item: LetterLogItem, index: number): ReactNode;
  renderCommentColumn?(item: LetterLogItem, index: number): ReactNode;
}) {
  return (
    <section className="letter-paper" aria-label="员工工作日志信纸">
      <header className="letter-heading">
        <strong>员工工作日志</strong>
        <span>逐项评注</span>
      </header>
      <div className="letter-body">
        {items.map((item, index) => (
          <article className="letter-row" key={item.position ?? index}>
            <div className="letter-content">
              <span className="work-index">{item.position ?? index + 1}</span>
              {renderItem ? renderItem(item, index) : (
                <div className="letter-readonly-item">
                  <p>{item.content}</p>
                  <LetterImages images={item.images} />
                </div>
              )}
            </div>
            <aside className="letter-comment-column" aria-label={`事项 ${item.position ?? index + 1} 评注`}>
              {renderCommentColumn?.(item, index) ?? <p className="comment-placeholder">审批人将在这里逐项评注</p>}
            </aside>
          </article>
        ))}
      </div>
      <footer className="letter-signature">
        <span>员工姓名：{employeeName}</span>
        <span>日志日期：{workDate}</span>
      </footer>
    </section>
  );
}
