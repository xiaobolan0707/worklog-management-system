import { useState, type ClipboardEvent } from "react";

import { base64ByteLength, dataUrlPayload, effectiveCharacterCount } from "../../../shared/text.js";
import { Icon } from "../Icon.js";
import { LetterImages, LetterLog, type LetterImage } from "./LetterLog.js";

export interface EditableWorkItem {
  content: string;
  completed: boolean;
  unfinishedReason?: string | undefined;
  images: LetterImage[];
}


const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * 图片在日志正文中以 base64 内联保存，未压缩时单张可达 10MB（base64 后约 13MB），
 * 会让「提交」需要先上传整份正文，弱网下表现为长时间无响应。
 * 这里在浏览器端统一缩放到最长边 1600px 并转 JPEG，通常可从数 MB 降到 200–400KB。
 */
async function compressImage(file: File): Promise<{ dataUrl: string; size: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");
  // PNG 透明区域转 JPEG 会变黑，先铺白底。
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const payload = dataUrlPayload(dataUrl);
  // 服务端按 `Buffer.byteLength(base64,"base64") === size` 校验，这里必须用真实解码字节数。
  if (!dataUrl.startsWith("data:image/jpeg;base64,") || !payload) throw new Error("CANVAS_ENCODE_FAILED");
  return { dataUrl, size: base64ByteLength(payload) };
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

  function moveImage(index: number, imageIndex: number, direction: -1 | 1) {
    const images = [...(items[index]?.images ?? [])];
    const target = imageIndex + direction;
    if (target < 0 || target >= images.length) return;
    [images[imageIndex], images[target]] = [images[target]!, images[imageIndex]!];
    update(index, { images });
  }

  function addImages(index: number, files: FileList | File[] | null) {
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
    void Promise.all(selected.map(async (file) => {
      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.name}`;
      const name = file.name || "粘贴图片";
      try {
        const compressed = await compressImage(file);
        return {
          id, name, type: "image/jpeg" as LetterImage["type"], size: compressed.size, dataUrl: compressed.dataUrl
        } satisfies LetterImage;
      } catch {
        return await new Promise<LetterImage>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve({
            id, name, type: file.type as LetterImage["type"], size: file.size, dataUrl: String(reader.result)
          });
          reader.readAsDataURL(file);
        });
      }
    }))
      .then((images) => update(index, { images: [...existing, ...images] }))
      .catch(() => setImageError("图片读取失败，请重新选择"));
  }

  function pasteImages(index: number, event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file?.type.startsWith("image/")));
    if (!files.length) return;
    event.preventDefault();
    addImages(index, files);
  }

  return (
    <div className="work-items">
      {imageError && <p className="form-error" role="alert">{imageError}</p>}
      <LetterLog
        items={items}
        employeeName={employeeName}
        workDate={workDate}
        renderItem={(item, index) => {
          const characterCount = effectiveCharacterCount(item.content);
          return <div className="work-fields">
            <label className="field"><span>工作内容</span><textarea aria-label={`工作内容 ${index + 1}`} value={item.content} disabled={disabled} onChange={(event) => update(index, { content: event.target.value })} onPaste={(event) => pasteImages(index, event)} /></label>
            {!disabled && <small className={characterCount < 20 ? "character-count invalid" : "character-count"}>{characterCount} / 最少 20 字</small>}
            <LetterImages images={item.images} />
            {!disabled && <label className="image-upload"><span><Icon name="image" />插入图片</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label={`上传图片 ${index + 1}`} onChange={(event) => addImages(index, event.target.files)} /></label>}
            {!disabled && item.images?.map((image, imageIndex) => <div className="image-actions" key={image.id}>
              {imageIndex > 0 && <button type="button" className="text-button" aria-label={`上移图片 ${image.name}`} onClick={() => moveImage(index, imageIndex, -1)}>上移</button>}
              {imageIndex < (item.images?.length ?? 0) - 1 && <button type="button" className="text-button" aria-label={`下移图片 ${image.name}`} onClick={() => moveImage(index, imageIndex, 1)}>下移</button>}
              <button type="button" className="text-button danger" onClick={() => update(index, { images: item.images?.filter((current) => current.id !== image.id) ?? [] })}>删除图片：{image.name}</button>
            </div>)}
            {!disabled && items.length > 4 && <button type="button" className="text-button danger" aria-label={`删除工作项 ${index + 1}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>删除此项</button>}
          </div>;
        }}
      />
      {!disabled && <button type="button" className="btn secondary add-item" onClick={() => onChange([...items, { content: "", completed: true, images: [] }])}><Icon name="plus" />添加工作项</button>}
    </div>
  );
}
