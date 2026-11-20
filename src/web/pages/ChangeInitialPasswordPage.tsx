import { useState, type FormEvent } from "react";

export function ChangeInitialPasswordPage({
  onChange
}: {
  onChange(currentPassword: string, newPassword: string): Promise<void>;
}) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      setError("两次输入的新密码不一致");
      return;
    }
    try {
      await onChange(String(form.get("currentPassword")), newPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改失败");
    }
  }
  return (
    <main className="center-page">
      <section className="panel password-panel">
        <h1>首次登录，请设置新密码</h1>
        <p className="muted">密码至少 6 位。</p>
        <form onSubmit={submit}>
          <label className="field"><span>初始密码</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label>
          <label className="field"><span>新密码</span><input name="newPassword" type="password" autoComplete="new-password" minLength={6} maxLength={256} required /></label>
          <label className="field"><span>确认新密码</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={256} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary wide">保存新密码</button>
        </form>
      </section>
    </main>
  );
}
