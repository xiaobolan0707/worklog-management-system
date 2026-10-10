import { useEffect, useState } from "react";

import { apiRequest } from "../api/client.js";

interface Reminder {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
}

export function ReminderMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Reminder[]>([]);
  useEffect(() => {
    if (open) void apiRequest<{ reminders: Reminder[] }>("/reminders").then((result) => setItems(result.reminders));
  }, [open]);
  return (
    <div className="reminder-menu">
      <button className="icon-button" aria-label="系统提醒" onClick={() => setOpen((value) => !value)}>
        ◉{items.some((item) => !item.readAt) && <span className="notification-dot" />}
      </button>
      {open && (
        <section className="reminder-popover" aria-label="提醒列表">
          <strong>系统提醒</strong>
          {items.length === 0 ? <p className="muted">暂无新提醒</p> : items.map((item) => (
            <article key={item.id} className={item.readAt ? "" : "unread"}>
              <b>{item.title}</b><p>{item.body}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
