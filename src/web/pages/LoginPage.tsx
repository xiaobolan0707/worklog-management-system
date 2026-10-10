import { useState, type FormEvent } from "react";

export function LoginPage({ onLogin }: { onLogin(username: string, password: string): Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
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

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">志</div>
        <p className="eyebrow">WORKLOG SYSTEM</p>
        <h1>让每一天的工作<br />清晰、可见、可追踪</h1>
        <p>面向项目研发团队的工作日志与红灰核查平台</p>
      </section>
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">WELCOME BACK</p>
        <h2 id="login-title">登录工作台</h2>
        <p className="muted">请使用管理员为您创建的账号登录</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>用户名</span>
            <input name="username" autoComplete="username" required />
          </label>
          <label className="field">
            <span>密码</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary wide" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
        </form>
      </section>
    </main>
  );
}
