/**
 * Motion Prompt 动效组件库
 *
 * 每个组件对应 motion-prompt 的 ui 包元素，时长 / 缓动 / 位移取自原始规格，
 * 视觉换成 styles.css 的语义令牌（换皮自动跟随）。实现见同目录 motion.css。
 * 版权：MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/
 *
 *   #056 Toast · #069 Skeleton · #072 EmptyState · #071 CountBadge
 *   #050 Drawer · #049 Modal · #053 Dropdown · #054 Tooltip
 *   #052 Accordion · #060 Segmented · #057 Tabs · #068 Steps
 */
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode
} from "react";

/* ------------------------------------------------------------------ #056 Toast */

interface ToastItem { id: number; message: string; tone: "success" | "info" }
interface ToastApi { show(message: string, tone?: "success" | "info"): void }

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((message: string, tone: "success" | "info" = "success") => {
    window.clearTimeout(timer.current);
    // key 变化让 CSS 生命周期动画重新播放：滑入 350ms → 停留 1.8s → 滑出 350ms
    setToast({ id: Date.now() + Math.random(), message, tone });
    timer.current = window.setTimeout(() => setToast(null), 2150);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div key={toast.id} className={`mp-toast ${toast.tone}`} role="status" aria-live="polite">
          <span className="mp-toast-ico" aria-hidden="true">{toast.tone === "success" ? "✓" : "i"}</span>
          <span>{toast.message}</span>
          <span className="mp-toast-bar" aria-hidden="true" />
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/* --------------------------------------------------------------- #069 Skeleton */

export function Skeleton({ rows = 3, label = "正在加载…" }: { rows?: number; label?: string }) {
  return (
    <div className="mp-skeleton" role="status">
      <span className="mp-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="mp-sk-row" key={index}>
          <div className="mp-sk-av" />
          <div className="mp-sk-lines">
            <div className="mp-sk-l mp-sk-l1" /><div className="mp-sk-l mp-sk-l2" /><div className="mp-sk-l mp-sk-l3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- #072 Empty state */

export function EmptyState({
  title, hint, actionLabel, onAction
}: { title: string; hint?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="mp-empty">
      <svg width="38" height="38" viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 13h24v14H5z" /><path d="M5 13l3-7h18l3 7" /><path d="M5 13h8l1.5 4h5L21 13h8" />
      </svg>
      <p>{title}</p>
      {hint && <small>{hint}</small>}
      {actionLabel && onAction && <button className="btn primary" type="button" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

/* ---------------------------------------------------------------- #071 Badge */

export function CountBadge({
  count, label = "未处理事项", onClear
}: { count: number; label?: string; onClear?: () => void }) {
  const [pop, setPop] = useState(false);
  const lastCount = useRef(count);
  useEffect(() => {
    const grew = count > lastCount.current;
    lastCount.current = count;
    if (!grew) return;
    setPop(true);
    const timer = window.setTimeout(() => setPop(false), 300);
    return () => window.clearTimeout(timer);
  }, [count]);

  return (
    <span className="mp-badge-wrap">
      <button
        type="button"
        className={`mp-badge${count > 0 ? " on" : ""}${pop ? " pop" : ""}`}
        aria-label={`${label} ${count} 条${onClear ? "，点击清零" : ""}`}
        onClick={onClear}
        disabled={!onClear}
      >
        {Math.min(count, 99)}
        <span className="mp-badge-ring" aria-hidden="true" />
      </button>
    </span>
  );
}

/* ------------------------------------------------------- #050 / #049 浮层基座 */

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return <button type="button" className="mp-layer-x" aria-label="关闭" onClick={onClose}>×</button>;
}

export function Drawer({
  open, title, onClose, children
}: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEscape(open, onClose);
  return (
    <div className={`mp-layer${open ? " on" : ""}`} aria-hidden={!open}>
      <div className="mp-scrim" onClick={onClose} />
      <aside className="mp-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <CloseButton onClose={onClose} />
        <h2>{title}</h2>
        {children}
      </aside>
    </div>
  );
}

export function Modal({
  open, title, onClose, children, actions
}: { open: boolean; title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEscape(open, onClose);
  return (
    <div className={`mp-layer mp-layer-modal${open ? " on" : ""}`} aria-hidden={!open}>
      <div className="mp-scrim" onClick={onClose} />
      <div className="mp-modal" role="dialog" aria-modal="true" aria-label={title}>
        <CloseButton onClose={onClose} />
        <h2>{title}</h2>
        {children}
        {actions && <div className="mp-modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- #053 Dropdown */

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

export function Dropdown({
  label, value, placeholder = "请选择", options, onChange, ariaLabel
}: {
  label?: string;
  value: string;
  placeholder?: string;
  options: string[];
  onChange(value: string): void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="mp-select-wrap" ref={wrap}>
      {label && <span className="f-label" style={{ display: "block", marginBottom: 6 }}>{label}</span>}
      <button
        type="button"
        className={`mp-select${open ? " on" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value ? "" : "mp-placeholder"}>{value || placeholder}</span>
        <Chevron />
      </button>
      <ul className={`mp-menu${open ? " on" : ""}`} role="listbox" aria-label={ariaLabel ?? label}>
        {options.map((option) => (
          <li
            key={option}
            role="option"
            aria-selected={option === value}
            onClick={() => { onChange(option); setOpen(false); }}
          >
            {option}<i aria-hidden="true">✓</i>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- #054 Tooltip */

export function Tooltip({ text }: { text: string }) {
  return (
    <span className="mp-tt-anchor">
      <button type="button" className="mp-tt-q" aria-label="指标说明">?</button>
      <span className="mp-tt-bubble" role="tooltip">{text}</span>
    </span>
  );
}

/* ------------------------------------------------------------- #052 Accordion */

export function Accordion({
  items, initial = 0
}: { items: { title: string; content: ReactNode }[]; initial?: number }) {
  const [active, setActive] = useState(initial);
  return (
    <div className="mp-acc">
      {items.map((item, index) => {
        const open = active === index;
        return (
          <div className={`mp-acc-item${open ? " open" : ""}`} key={item.title}>
            <button type="button" className="mp-acc-head" aria-expanded={open} onClick={() => setActive(open ? -1 : index)}>
              <span>{item.title}</span><Chevron />
            </button>
            <div className="mp-acc-body"><div className="mp-acc-inner"><div>{item.content}</div></div></div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ #060 Segmented */

export function Segmented({
  options, value, onChange, ariaLabel
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange(value: string): void;
  ariaLabel?: string;
}) {
  const count = Math.max(1, options.length);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const thumb: CSSProperties = {
    width: `calc((100% - 6px) / ${count})`,
    left: `calc(3px + (100% - 6px) / ${count} * ${index})`
  };
  return (
    <div className="mp-seg" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }} role="group" aria-label={ariaLabel}>
      <span className="mp-seg-thumb" style={thumb} aria-hidden="true" />
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ #057 Tabs */

export function Tabs({
  tabs, initial = 0
}: { tabs: { label: string; content: ReactNode }[]; initial?: number }) {
  const [active, setActive] = useState(initial);
  const [shown, setShown] = useState(initial);
  const [fading, setFading] = useState(false);
  const underline = useRef<HTMLSpanElement | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const button = buttons.current[active];
    if (button && underline.current) {
      underline.current.style.left = `${button.offsetLeft}px`;
      underline.current.style.width = `${button.offsetWidth}px`;
    }
  }, [active, tabs.length]);

  useEffect(() => {
    if (active === shown) return;
    setFading(true);
    const timer = window.setTimeout(() => { setShown(active); setFading(false); }, 200);
    return () => window.clearTimeout(timer);
  }, [active, shown]);

  return (
    <>
      <div className="mp-tabs" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            ref={(node) => { buttons.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={active === index}
            onClick={() => setActive(index)}
          >{tab.label}</button>
        ))}
        <span className="mp-tabs-ul" ref={underline} aria-hidden="true" />
      </div>
      <div className={`mp-tab-panel${fading ? " out" : ""}`} key={shown} role="tabpanel">
        {tabs[shown]?.content}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- #068 Steps */

export function Steps({ labels, current }: { labels: string[]; current: number }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const line = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const items = wrap.current?.querySelectorAll<HTMLElement>(".mp-step");
    if (!items || items.length === 0) return;
    const first = items.item(0);
    const last = items.item(items.length - 1);
    const target = items.item(Math.max(0, Math.min(current, items.length - 1)));
    if (!first || !last || !target) return;
    const center = (element: HTMLElement) => element.offsetLeft + element.offsetWidth / 2;
    const start = center(first);
    const end = center(last);
    const to = center(target);
    if (track.current) { track.current.style.left = `${start}px`; track.current.style.width = `${end - start}px`; }
    if (line.current) { line.current.style.left = `${start}px`; line.current.style.width = `${Math.max(0, to - start)}px`; }
  }, [current, labels.length]);

  return (
    <div className="mp-steps" ref={wrap}>
      <div className="mp-step-track" ref={track} aria-hidden="true" />
      <div className="mp-step-line" ref={line} aria-hidden="true" />
      {labels.map((label, index) => {
        const state = index < current ? "done" : index === current ? "cur" : "";
        return (
          <div className={`mp-step ${state}`} key={label}>
            <span className="mp-step-dot" aria-hidden="true">{index < current ? "✓" : index + 1}</span>
            <small>{label}</small>
          </div>
        );
      })}
    </div>
  );
}
