import type { ReactNode } from "react";

export interface LetterImage {
  id: string;
  name: string;
  type: "image/jpeg" | "image/png" | "image/webp";
  size: number;
  dataUrl: string;
}

export interface LetterLogItem {
  position?: number;
  content: string;
  completed: boolean;
  unfinishedReason?: string | null | undefined;
  images?: LetterImage[] | undefined;
}

export function LetterImages({ images = [] }: { images?: LetterImage[] | undefined }) {
  if (images.length === 0) return null;
  return (
    <div className="letter-images">
      {images.map((image) => (
        <a href={image.dataUrl} target="_blank" rel="noreferrer" key={image.id}>
          <img src={image.dataUrl} alt={image.name} />
        </a>
      ))}
    </div>
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
