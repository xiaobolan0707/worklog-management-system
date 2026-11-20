import { useState, type FormEvent } from "react";

import { useAuth } from "../auth/AuthProvider.js";

const PASSWORD_HINT = "密码至少 6 位。";

export function AccountPasswordPage() {
  const auth = useAuth();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await auth.changePassword(String(form.get("currentPassword")), newPassword);
      setNotice("密码已修改，其他设备上的登录会话已失效。");
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改密码失败");
    } finally {
      setBusy(false);
    }
  }

  return <main className="page">
    <div className="page-head"><div><h1>修改密码</h1><p>修改成功后，其他设备上的登录会话将自动失效。</p></div></div>
    {notice && <p className="notice success">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="panel form-panel password-panel">
      <form onSubmit={submit}>
        <label className="field"><span>当前密码</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label className="field"><span>新密码</span><input name="newPassword" type="password" autoComplete="new-password" minLength={6} maxLength={256} required /></label>
        <p className="muted">{PASSWORD_HINT}</p>
        <label className="field"><span>确认新密码</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={256} required /></label>
        <div className="form-actions"><button className="btn primary" disabled={busy}>{busy ? "保存中…" : "保存新密码"}</button></div>
      </form>
    </section>
  </main>;
}
