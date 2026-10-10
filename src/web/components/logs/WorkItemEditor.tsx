export interface EditableWorkItem {
  content: string;
  completed: boolean;
  unfinishedReason?: string | undefined;
}

export function WorkItemEditor({
  items,
  onChange,
  disabled = false
}: {
  items: EditableWorkItem[];
  onChange(items: EditableWorkItem[]): void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<EditableWorkItem>) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  return (
    <div className="work-items">
      {items.map((item, index) => (
        <article className="work-item" key={index}>
          <span className="work-index">{index + 1}</span>
          <div className="work-fields">
            <label className="field"><span>工作内容</span><textarea aria-label={`工作内容 ${index + 1}`} value={item.content} disabled={disabled} onChange={(event) => update(index, { content: event.target.value })} /></label>
            <div className="row-fields">
              <label className="field"><span>完成情况</span><select aria-label={`完成状态 ${index + 1}`} value={String(item.completed)} disabled={disabled} onChange={(event) => update(index, { completed: event.target.value === "true", unfinishedReason: event.target.value === "true" ? "" : item.unfinishedReason })}><option value="true">已完成</option><option value="false">未完成</option></select></label>
              {!item.completed && <label className="field"><span>未完成原因</span><input aria-label={`未完成原因 ${index + 1}`} value={item.unfinishedReason ?? ""} disabled={disabled} onChange={(event) => update(index, { unfinishedReason: event.target.value })} /></label>}
            </div>
            {!disabled && items.length > 1 && <button type="button" className="text-button danger" aria-label={`删除工作项 ${index + 1}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>删除此项</button>}
          </div>
        </article>
      ))}
      {!disabled && <button type="button" className="btn secondary add-item" onClick={() => onChange([...items, { content: "", completed: true }])}>＋ 添加工作项</button>}
    </div>
  );
}
