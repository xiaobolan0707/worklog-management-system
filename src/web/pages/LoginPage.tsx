import { useEffect, useState, type FormEvent } from "react";

import { apiRequest } from "../api/client.js";

interface RegistrationMode {
  open: boolean;
  inviteRequired: boolean;
  passwordPolicy?: string;
}

export function LoginPage({ onLogin }: { onLogin(username: string, password: string): Promise<void> }) {
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<RegistrationMode>({ open: false, inviteRequired: false });

  useEffect(() => {
    // SEC-03：自助注册是否开放由服务端决定，前端不猜测邀请码。
    void apiRequest<RegistrationMode>("/auth/registration-mode")
      .then(setMode)
      .catch(() => setMode({ open: false, inviteRequired: false }));
  }, []);

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
          confirmPassword,
          ...(mode.inviteRequired ? { inviteCode: String(form.get("inviteCode") ?? "") } : {})
        })
      });
      setRegistering(false);
      setNotice("注册申请已提交，请等待管理员审核并启用账号。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-wordmark"><div className="brand-mark">志</div><strong>工作志 <small>WORKLOG</small></strong></div>
        <h1>让每一天的工作<br />清晰、可见、可追踪</h1>
        <p>面向项目研发团队的工作日志与核查平台</p>
        <div className="auth-workflow"><span>记录工作</span><span aria-hidden="true">/</span><span>逐项核查</span><span aria-hidden="true">/</span><span>回顾成长</span></div>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <h2 id="auth-title">{registering ? "员工注册" : "登录工作台"}</h2>
        <p className="muted">{registering ? "提交后需管理员审核并启用账号" : "请使用您的账号登录"}</p>
        {notice && <p className="notice">{notice}</p>}
        {registering ? (
          <form onSubmit={register}>
            <label className="field"><span>姓名</span><input name="displayName" autoComplete="name" maxLength={100} required /></label>
            <label className="field"><span>用户名</span><input name="username" autoComplete="username" minLength={2} maxLength={64} pattern="[a-zA-Z0-9._-]+" required /></label>
            <label className="field"><span>密码</span><input name="password" type="password" autoComplete="new-password" minLength={6} maxLength={256} required /></label>
            <p className="muted">{mode.passwordPolicy ?? "密码至少 6 位"}</p>
            <label className="field"><span>确认密码</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={256} required /></label>
            {mode.inviteRequired && <><label className="field"><span>注册邀请码</span><input name="inviteCode" autoComplete="off" required /></label><p className="muted">请向人事或管理员索取</p></>}
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
            {mode.open
              ? <button type="button" className="btn secondary wide" onClick={() => switchMode(true)}>员工注册</button>
              : <p className="muted">暂未开放自助注册，请联系管理员开通账号。</p>}
          </form>
        )}
      </section>
    </main>
  );
}
