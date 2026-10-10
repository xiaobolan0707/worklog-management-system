import { useEffect, useState } from "react";

import { apiRequest } from "../../api/client.js";

interface AdminUser { id: string; username: string; displayName: string | null; role: string }

export function ApproversPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void apiRequest<{ users: AdminUser[] }>("/admin/users").then((result) => setUsers(result.users));
  }, []);
  const employees = users.filter((user) => user.role === "EMPLOYEE");
  const leaders = users.filter((user) => user.role === "LEADER" || user.role === "MANAGEMENT");
  function nameFor(id: string) {
    const user = users.find((candidate) => candidate.id === id);
    return user ? `${user.displayName || user.username}（${user.username}）` : id;
  }
  function addLeader() {
    if (leaderId && !ids.includes(leaderId)) setIds((current) => [...current, leaderId]);
    setLeaderId("");
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    setIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  async function save() {
    await apiRequest(`/admin/users/${employeeId}/approvers`, {
      method: "PUT",
      body: JSON.stringify({ approverIds: ids })
    });
    setNotice("审批顺序已保存");
  }
  return <main className="page"><div className="page-head"><div><p className="eyebrow">APPROVAL CHAIN</p><h1>审批配置</h1><p>按列表自上而下顺序审批，可设置多个审批人。</p></div></div><section className="panel split-form"><div><label className="field"><span>员工</span><select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">请选择员工</option>{employees.map((user) => <option key={user.id} value={user.id}>{nameFor(user.id)}</option>)}</select></label><label className="field"><span>添加审批人</span><select value={leaderId} onChange={(event) => setLeaderId(event.target.value)}><option value="">请选择领导</option>{leaders.map((user) => <option key={user.id} value={user.id}>{nameFor(user.id)}</option>)}</select></label><button className="btn secondary" disabled={!leaderId} onClick={addLeader}>加入审批链</button><button className="btn primary" disabled={!employeeId || ids.length === 0} onClick={() => void save()}>保存审批链</button>{notice && <p className="notice">{notice}</p>}</div><div><h2>当前顺序</h2>{ids.map((id, index) => <div className="order-row" key={id}><span>第 {index + 1} 级：{nameFor(id)}</span><span><button className="btn secondary" aria-label={`上移 ${nameFor(id)}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button className="btn secondary" aria-label={`下移 ${nameFor(id)}`} disabled={index === ids.length - 1} onClick={() => move(index, 1)}>↓</button><button className="btn secondary" aria-label={`移除 ${nameFor(id)}`} onClick={() => setIds((current) => current.filter((value) => value !== id))}>移除</button></span></div>)}</div></section></main>;
}
