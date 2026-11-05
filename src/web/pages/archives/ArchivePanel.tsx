import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "../../api/client.js";

export interface EmployeeArchive {
  id: string; username: string; displayName: string | null; gender: "MALE" | "FEMALE" | "UNDISCLOSED" | null;
  departmentId: string | null; departmentName: string | null; employeeNumberDisplay: string | null;
  numberDepartmentName: string | null; hireDate: string | null; departureDate: string | null;
  employmentStatus: "ACTIVE" | "DEPARTED"; completionDeadline: string; complete: boolean; missing: string[]; canEdit: boolean;
  attachments: { id: string; category: string; name: string; mimeType: string; size: number; createdAt: string }[];
}
export const archiveCategories = { RESUME: "简历", DEGREE: "学历证明", AGREEMENT: "劳动合同或合伙人协议" } as const;
const missingLabels: Record<string, string> = { ...archiveCategories, displayName: "姓名", gender: "性别", hireDate: "入职日期", departmentId: "所属部门", employeeNumber: "工号", NAME: "姓名", GENDER: "性别", HIRE_DATE: "入职日期", DEPARTMENT: "所属部门", EMPLOYEE_NUMBER: "工号" };
export const archiveDate = (date: string | null) => date ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date)) : "未填写";
export const requestMessage = (cause: unknown, fallback: string) => cause instanceof ApiError ? cause.message : fallback;

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

// I6：长文件名只截断基名，扩展名始终可见；无扩展名或后缀过长时整体视为基名。
export const splitFileName = (name: string): [string, string] => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || name.length - dot > 11) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
};

export function ArchivePanel({ employeeId, recycled = false, onLoaded }: { employeeId: string; recycled?: boolean; onLoaded?(archive: EmployeeArchive): void }) {
  const [archive, setArchive] = useState<EmployeeArchive | null>(null);
  const [name, setName] = useState("");
  const [gender, setGender] = useState("UNDISCLOSED");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const base = recycled ? `/recycle-bin/${employeeId}` : `/archives/${employeeId}`;
  useEffect(() => {
    let active = true;
    setArchive(null); setError("");
    void apiRequest<{ archive: EmployeeArchive }>(recycled ? `${base}/archive` : base).then(({ archive: next }) => {
      if (!active) return;
      setArchive(next); setName(next.displayName ?? ""); setGender(next.gender ?? ""); onLoaded?.(next);
    }).catch((cause) => { if (active) setError(requestMessage(cause, "档案加载失败，请重新加载")); });
    return () => { active = false; };
  }, [base, recycled, reload]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!name.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(base, { method: "PATCH", body: JSON.stringify({ displayName: name.trim(), gender }) }); setNotice("基本信息已保存"); setReload((n) => n + 1); }
    catch (cause) { setError(requestMessage(cause, "保存失败，请重试")); } finally { setBusy(false); }
  }
  async function upload(category: string, file: File, input: HTMLInputElement) {
    if (file.size > 10 * 1024 * 1024) { setError("单个附件不能超过 10 MB"); input.value = ""; return; }
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(`${base}/attachments`, { method: "POST", body: JSON.stringify({ category, name: file.name, data: await readFile(file) }) }); setNotice("附件已上传"); setReload((n) => n + 1); }
    catch (cause) { setError(requestMessage(cause, "附件上传失败，请重试")); } finally { input.value = ""; setBusy(false); }
  }
  async function remove(id: string, fileName: string) {
    if (!window.confirm(`确定删除附件“${fileName}”吗？删除后需重新上传。`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(`${base}/attachments/${id}`, { method: "DELETE" }); setNotice("附件已删除"); setReload((n) => n + 1); }
    catch (cause) { setError(requestMessage(cause, "附件删除失败，请重试")); } finally { setBusy(false); }
  }
  const editable = archive?.canEdit && archive.employmentStatus === "ACTIVE" && !recycled;
  return <div className="archive-content" aria-busy={busy}>
    {error && <div className="department-feedback"><p role="alert" className="form-error">{error}</p>{!archive && <button className="btn secondary" onClick={() => setReload((n) => n + 1)}>重新加载</button>}</div>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {!archive && !error && <p role="status">正在加载档案…</p>}
    {archive && <>
      <section className="panel"><div className="department-heading"><h2>基本信息</h2><span className="archive-state">{archive.employmentStatus === "DEPARTED" ? "离职 · 只读" : editable ? "本人可维护" : "只读档案"}</span></div>
        <dl className="profile-summary archive-summary"><div><dt>登录账号</dt><dd>{archive.username}</dd></div><div><dt>所属部门</dt><dd>{archive.departmentName ?? "未分配"}</dd></div><div><dt>工号</dt><dd>{archive.employeeNumberDisplay ?? "待人事分配"}</dd></div><div><dt>工号分配部门</dt><dd>{archive.numberDepartmentName ?? "未分配"}</dd></div><div><dt>入职日期</dt><dd>{archiveDate(archive.hireDate)}</dd></div><div><dt>离职日期</dt><dd>{archiveDate(archive.departureDate)}</dd></div></dl>
        {editable ? <form onSubmit={save}><div className="department-form-grid"><label className="field"><span>姓名</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required disabled={busy} /></label><label className="field"><span>性别</span><select aria-label="性别" value={gender} onChange={(event) => setGender(event.target.value)} required disabled={busy}><option value="" disabled>请选择性别</option><option value="UNDISCLOSED">不愿透露</option><option value="MALE">男</option><option value="FEMALE">女</option></select></label></div><button className="btn primary" disabled={busy || !name.trim()}>{busy ? "处理中…" : "保存基本信息"}</button></form> : <dl className="profile-summary"><div><dt>姓名</dt><dd>{archive.displayName ?? "未填写"}</dd></div><div><dt>性别</dt><dd>{archive.gender ? { MALE: "男", FEMALE: "女", UNDISCLOSED: "不愿透露" }[archive.gender] : "未填写"}</dd></div></dl>}
      </section>
      <section className="panel"><h2>资料补齐进度</h2><p>{archive.complete ? "资料已补齐" : "资料待补齐"} · 补齐截止日：{archiveDate(archive.completionDeadline)}</p>{!archive.complete && <p className="muted">待补齐：{archive.missing.map((field) => missingLabels[field] ?? field).join("、")}。工号与任职日期由人事维护。</p>}</section>
      <section className="panel"><h2>档案附件</h2><p className="muted">支持 PDF、JPG、PNG、DOCX；每份不超过 10 MB，每类最多 10 份。</p>
        {Object.entries(archiveCategories).map(([category, label]) => { const files = archive.attachments.filter((file) => file.category === category); return <section className="archive-attachment-group" key={category}><h3>{label}<span className="muted">（{files.length}/10）</span></h3>
          {files.length ? <ul className="archive-files">{files.map((file) => { const [baseName, ext] = splitFileName(file.name); return <li key={file.id}><a href={`/api${base}/attachments/${file.id}`} download={file.name} title={file.name}><span className="file-base">{baseName}</span><span className="file-ext">{ext}</span></a><small className="muted">{(file.size / 1024).toFixed(0)} KB</small>{editable && <button type="button" className="btn secondary" disabled={busy} aria-label={`删除附件${file.name}`} onClick={() => void remove(file.id, file.name)}>删除</button>}</li>; })}</ul> : <p className="muted">尚未上传{label}</p>}
          {editable && <label className="field archive-upload"><span>上传{label}</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" disabled={busy || files.length >= 10} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) void upload(category, file, input); }} /></label>}
        </section>; })}
      </section>
    </>}
  </div>;
}
