import { useState } from "react";

import { LetterImages, LetterLog, type LetterImage } from "./LetterLog.js";

export interface EditableWorkItem {
  content: string;
  completed: boolean;
  unfinishedReason?: string | undefined;
  images: LetterImage[];
}

export function WorkItemEditor({
  items,
  onChange,
  disabled = false,
  employeeName = "—",
  workDate = "—"
}: {
  items: EditableWorkItem[];
  onChange(items: EditableWorkItem[]): void;
  disabled?: boolean;
  employeeName?: string;
  workDate?: string;
}) {
  const [imageError, setImageError] = useState("");

  function update(index: number, patch: Partial<EditableWorkItem>) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function addImages(index: number, files: FileList | null) {
    if (!files?.length) return;
    const existing = items[index]?.images ?? [];
    const selected = [...files];
    if (existing.length + selected.length > 6) {
      setImageError("每项最多上传 6 张图片");
      return;
    }
    if (selected.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setImageError("仅支持 JPG、PNG 或 WebP 图片");
      return;
    }
    if (selected.some((file) => file.size > 10 * 1024 * 1024)) {
      setImageError("单张图片不能超过 10 MB");
      return;
    }
    setImageError("");
    void Promise.all(selected.map((file) => new Promise<LetterImage>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve({
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.name}`,
        name: file.name,
        type: file.type as LetterImage["type"],
        size: file.size,
        dataUrl: String(reader.result)
      });
      reader.readAsDataURL(file);
    }))).then((images) => update(index, { images: [...existing, ...images] }));
  }

  return (
    <div className="work-items">
      {imageError && <p className="form-error" role="alert">{imageError}</p>}
      <LetterLog
        items={items}
        employeeName={employeeName}
        workDate={workDate}
        renderItem={(item, index) => (
          <div className="work-fields">
            <label className="field"><span>工作内容</span><textarea aria-label={`工作内容 ${index + 1}`} value={item.content} disabled={disabled} onChange={(event) => update(index, { content: event.target.value })} /></label>
            <div className="row-fields">
              <label className="field"><span>完成情况</span><select aria-label={`完成状态 ${index + 1}`} value={String(item.completed)} disabled={disabled} onChange={(event) => update(index, { completed: event.target.value === "true", unfinishedReason: event.target.value === "true" ? "" : item.unfinishedReason ?? undefined })}><option value="true">已完成</option><option value="false">未完成</option></select></label>
              {!item.completed && <label className="field"><span>未完成原因</span><input aria-label={`未完成原因 ${index + 1}`} value={item.unfinishedReason ?? ""} disabled={disabled} onChange={(event) => update(index, { unfinishedReason: event.target.value })} /></label>}
            </div>
            <LetterImages images={item.images} />
            {!disabled && <label className="image-upload"><span>＋ 插入图片</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label={`上传图片 ${index + 1}`} onChange={(event) => addImages(index, event.target.files)} /></label>}
            {!disabled && item.images?.map((image) => <button type="button" className="text-button danger" key={image.id} onClick={() => update(index, { images: item.images?.filter((current) => current.id !== image.id) ?? [] })}>删除图片：{image.name}</button>)}
            {!disabled && items.length > 4 && <button type="button" className="text-button danger" aria-label={`删除工作项 ${index + 1}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>删除此项</button>}
          </div>
        )}
      />
      {!disabled && <button type="button" className="btn secondary add-item" onClick={() => onChange([...items, { content: "", completed: true, images: [] }])}>＋ 添加工作项</button>}
    </div>
  );
}
