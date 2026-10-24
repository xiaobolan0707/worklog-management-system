import { useState, type FormEvent } from "react";

import { apiRequest } from "../api/client.js";

export function LoginPage({ onLogin }: { onLogin(username: string, password: string): Promise<void> }) {
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(register: boolean) {
    setRegistering(register);
    setError("");
    setNotice("");
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onLogin(String(form.get("username")), String(form.get("password")));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const confirmPassword = String(form.get("confirmPassword"));
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          displayName: String(form.get("displayName")),
          username: String(form.get("username")),
          password,
          confirmPassword
        })
      });
      setRegistering(false);
      setNotice("注册成功，请等待管理员启用账号。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">志</div>
        <p className="eyebrow">WORKLOG SYSTEM</p>
        <h1>让每一天的工作<br />清晰、可见、可追踪</h1>
        <p>面向项目研发团队的工作日志与红灰核查平台</p>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">{registering ? "EMPLOYEE SIGN UP" : "WELCOME BACK"}</p>
        <h2 id="auth-title">{registering ? "员工注册" : "登录工作台"}</h2>
        <p className="muted">{registering ? "注册后请等待管理员启用账号" : "请使用您的账号登录"}</p>
        {notice && <p className="notice">{notice}</p>}
        {registering ? (
          <form onSubmit={register}>
            <label className="field"><span>姓名</span><input name="displayName" autoComplete="name" maxLength={100} required /></label>
            <label className="field"><span>用户名</span><input name="username" autoComplete="username" minLength={2} maxLength={64} pattern="[a-zA-Z0-9._-]+" required /></label>
            <label className="field"><span>密码</span><input name="password" type="password" autoComplete="new-password" minLength={6} required /></label>
            <label className="field"><span>确认密码</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn primary wide" disabled={busy}>{busy ? "注册中…" : "提交注册"}</button>
            <button type="button" className="btn secondary wide" onClick={() => switchMode(false)}>返回登录</button>
          </form>
        ) : (
          <form onSubmit={login}>
            <label className="field"><span>用户名</span><input name="username" autoComplete="username" required /></label>
            <label className="field"><span>密码</span><input name="password" type="password" autoComplete="current-password" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn primary wide" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
            <button type="button" className="btn secondary wide" onClick={() => switchMode(true)}>员工注册</button>
          </form>
        )}
      </section>
    </main>
  );
}
