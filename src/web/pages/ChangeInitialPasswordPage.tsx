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
    try {
      await onChange(String(form.get("currentPassword")), String(form.get("newPassword")));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改失败");
    }
  }
  return (
    <main className="center-page">
      <section className="panel password-panel">
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>首次登录，请设置新密码</h1>
        <p className="muted">新密码至少 12 位，保存后即可进入工作台。</p>
        <form onSubmit={submit}>
          <label className="field"><span>初始密码</span><input name="currentPassword" type="password" required /></label>
          <label className="field"><span>新密码</span><input name="newPassword" type="password" minLength={12} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary wide">保存新密码</button>
        </form>
      </section>
    </main>
  );
}
