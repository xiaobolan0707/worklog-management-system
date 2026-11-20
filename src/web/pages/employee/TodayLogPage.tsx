import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { WorkItemEditor, type EditableWorkItem } from "../../components/logs/WorkItemEditor.js";
import type { LetterImage } from "../../components/logs/LetterLog.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { useToast } from "../../components/motion/index.js";
import { base64ByteLength, dataUrlPayload, effectiveCharacterCount } from "../../../shared/text.js";
import { beijingParts } from "../../../shared/beijing-time.js";

interface LogView {
  id: string;
  status: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  employeeName: string;
  workDate: string;
  items: EditableWorkItem[];
}

const emptyItem = (): EditableWorkItem => ({ content: "", completed: true, images: [] });

/**
 * 兼容浏览器里已缓存的旧草稿：早期压缩逻辑按 base64 长度 ×0.75 估算 size，与服务端
 * 「真实解码字节数」校验不一致。加载时按 dataUrl 重算，避免旧草稿永远保存失败。
 */
function withExactImageSizes(images: LetterImage[]) {
  return images.map((image) => {
    // 待审/列表接口只下发 url，没有内联 base64 时无需也无法重算尺寸。
    const payload = image.dataUrl ? dataUrlPayload(image.dataUrl) : "";
    return payload ? { ...image, size: base64ByteLength(payload) } : image;
  });
}

function withFourItems(items: EditableWorkItem[]) {
  return [...items.map((item) => ({ ...item, completed: true, unfinishedReason: undefined, images: withExactImageSizes(item.images ?? []) })), ...Array.from({ length: Math.max(0, 4 - items.length) }, emptyItem)];
}

function todayInBeijing() {
  return beijingParts(new Date()).date;
}

function storageKey(userId: string) {
  return `worklog:today-draft:${userId}:${todayInBeijing()}`;
}

export function TodayLogPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<EditableWorkItem[]>(() => withFourItems([]));
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [log, setLog] = useState<LogView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    try { setItems(withFourItems(JSON.parse(localStorage.getItem(storageKey(user.id)) ?? "null") ?? [])); }
    catch { setItems(withFourItems([])); }
    setLoadedUserId(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    void apiRequest<{ logs: { id: string; workDate: string }[] }>("/logs/mine?pageSize=50").then(({ logs }) => {
      const current = logs.find((candidate) => candidate.workDate === todayInBeijing());
      if (current) {
        void apiRequest<{ log: LogView }>(`/logs/${current.id}`).then(({ log: fullLog }) => {
          setLog(fullLog);
          setItems(withFourItems(fullLog.items));
        }).catch(() => setError("今日日志加载失败，请刷新重试"));
      }
    }).catch(() => setError("今日日志加载失败，请刷新重试"));
  }, [user?.id]);
  useEffect(() => {
    if (user && loadedUserId === user.id && (!log || ["DRAFT", "RETURNED"].includes(log.status))) {
      try { localStorage.setItem(storageKey(user.id), JSON.stringify(items)); }
      catch { setError("浏览器空间不足，草稿未能在本机缓存，请及时保存到服务器"); }
    }
  }, [items, log, loadedUserId, user?.id]);

  function validateForSubmit() {
    if (items.length < 4) return "工作日志至少需要填写 4 项";
    const shortIndex = items.findIndex((item) => effectiveCharacterCount(item.content) < 20);
    if (shortIndex >= 0) return `第 ${shortIndex + 1} 项工作内容至少需要填写 20 字`;
    return "";
  }

  async function saveDraft() {
    setError("");
    try {
      const result = await apiRequest<{ log: LogView }>(log ? `/logs/${log.id}` : "/logs/drafts", {
        method: log ? "PUT" : "POST",
        body: JSON.stringify({ workDate: todayInBeijing(), items })
      });
      setLog(result.log);
      toast.show("草稿已保存");
      return result.log;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "草稿保存失败，请重试");
      return null;
    }
  }

  async function submit() {
    if (busy) return;
    const message = validateForSubmit();
    if (message) { setError(message); return; }
    setBusy(true);
    try {
      const draft = await saveDraft();
      if (!draft) return;
      const result = await apiRequest<{ log: LogView }>(`/logs/${draft.id}/submit`, { method: "POST" });
      setLog(result.log);
      toast.show("日志已提交，等待领导核查");
      if (user) localStorage.removeItem(storageKey(user.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!log || !window.confirm("确定删除今天的草稿吗？删除后不可恢复。")) return;
    setError("");
    try {
      await apiRequest(`/logs/${log.id}`, { method: "DELETE" });
      setLog(null);
      setItems(withFourItems([]));
      if (user) localStorage.removeItem(storageKey(user.id));
      toast.show("草稿已删除", "info");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除草稿失败，请重试");
    }
  }

  const locked = Boolean(log && !["DRAFT", "RETURNED"].includes(log.status));

  return (
    <main className="page">
      <div className="page-head"><div><p className="page-date">{todayInBeijing()}</p><h1>今日工作日志</h1><p>按 1、2、3… 逐项填写当天工作，完成情况由领导核查。</p></div>{log && <StatusBadge color={log.color} />}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="panel form-panel">
        <WorkItemEditor
          items={items}
          onChange={setItems}
          disabled={locked}
          employeeName={log?.employeeName ?? user?.displayName ?? user?.username ?? "—"}
          workDate={log?.workDate ?? todayInBeijing()}
        />
        {!locked && <div className="form-actions">{log?.status === "DRAFT" && <button className="btn secondary danger-action" onClick={() => void deleteDraft()}>删除草稿</button>}<button className="btn secondary" disabled={busy} onClick={() => void saveDraft()}>保存草稿</button><button className="btn primary" disabled={busy} onClick={() => void submit()}>{busy ? "提交中…" : "提交日志"}</button></div>}
      </section>
    </main>
  );
}
