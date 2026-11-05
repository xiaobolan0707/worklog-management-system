import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiRequest } from "../api/client.js";
import { Icon } from "./Icon.js";

interface Reminder {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  relatedLogId?: string | null;
}

export function ReminderMenu({ canOpenLogs = true, logPath = "/leader/logs" }: { canOpenLogs?: boolean; logPath?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const load = () => apiRequest<{ reminders: Reminder[] }>("/reminders")
    .then((result) => { setItems(result.reminders.filter((item) => !item.readAt)); setError(""); })
    .catch(() => setError("提醒加载失败，请重试"));
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    window.addEventListener("reminder-read", load);
    return () => { window.clearInterval(interval); window.removeEventListener("reminder-read", load); };
  }, []);
  function openReply(item: Reminder) {
    if (!item.relatedLogId) return;
    setOpen(false);
    navigate(`${logPath}/${item.relatedLogId}`, { state: item.readAt ? null : { reminderId: item.id } });
  }
  async function acknowledge(item: Reminder) {
    try {
      await apiRequest(`/reminders/${item.id}/read`, { method: "POST" });
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setError("");
    } catch {
      setError("查收失败，请重试");
    }
  }
  return (
    <div className="reminder-menu" onKeyDown={(event) => {
      if (event.key === "Escape") {
        setOpen(false);
        event.currentTarget.querySelector("button")?.focus();
      }
    }}>
      <button className={`icon-button${items.length ? " has-unread" : ""}`} aria-label="系统提醒" aria-expanded={open} onClick={() => { setOpen((value) => !value); void load(); }}>
        <Icon name="bell" />{items.length > 0 && <span className="notification-dot" />}
      </button>
      {open && (
        <section className="reminder-popover" aria-label="提醒列表">
          <strong>系统提醒</strong>
          {error && <p role="alert">{error}</p>}
          {items.length === 0 ? <p className="muted">暂无新提醒</p> : items.map((item) => (
            <article key={item.id} className="unread">
              {canOpenLogs && item.kind === "COMMENT_REPLY" && item.relatedLogId
                ? <button className="reminder-link" onClick={() => openReply(item)}><b>{item.title}</b><p>{item.body}</p></button>
                : <><b>{item.title}</b><p>{item.body}</p><button className="reminder-acknowledge" aria-label={`查收${item.title}`} onClick={() => void acknowledge(item)}>确认查收</button></>}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
