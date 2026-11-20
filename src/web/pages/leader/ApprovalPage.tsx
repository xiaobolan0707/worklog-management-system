import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../api/client.js";
import { ItemCommentThread, type ApprovalStepView } from "../../components/logs/ApprovalProgress.js";
import { LetterLog, type LetterLogItem } from "../../components/logs/LetterLog.js";

interface PendingLog { id:string; employeeId:string; employeeName:string; workDate:string; isBackfill:boolean; items:(LetterLogItem&{position:number})[]; approvalSteps:ApprovalStepView[] }

/** PERF-03：待审队列按页加载，避免一次性渲染上百封信纸卡片导致浏览器卡死。 */
const PAGE_SIZE = 10;

export function ApprovalPage() {
  const [logs,setLogs]=useState<PendingLog[]>([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState("");
  const [actionError,setActionError]=useState("");
  const [colors,setColors]=useState<Record<string,"RED"|"GRAY">>({});
  const [comments,setComments]=useState<Record<string,Record<number,string>>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  /** 处理完当前页最后一条后，用它触发一次重取，避免停在与总数矛盾的空态。 */
  const [reloadKey,setReloadKey]=useState(0);

  useEffect(()=>{
    let active=true;
    setLoading(true);
    void apiRequest<{logs:PendingLog[];total:number}>(`/approvals/pending?page=${page}&pageSize=${PAGE_SIZE}`)
      .then((result)=>{ if(!active) return; setLogs(result.logs); setTotal(result.total); setLoadError(""); })
      .catch(()=>{ if(!active) return; setLogs([]); setTotal(0); setLoadError("待审日志加载失败，请刷新重试"); })
      .finally(()=>{ if(active) setLoading(false); });
    return ()=>{ active=false; };
  },[page,reloadKey]);

  function setItemComment(logId:string,itemPosition:number,comment:string){setComments((current)=>({...current,[logId]:{...current[logId],[itemPosition]:comment}}));}

  const itemCommentsFor=useCallback((log:PendingLog)=>{
    const itemComments=log.items.map((item)=>({itemPosition:item.position,comment:comments[log.id]?.[item.position]?.trim()??""}));
    if(itemComments.some((item)=>!item.comment)){setErrors((current)=>({...current,[log.id]:"请针对每一项工作填写批注"}));return null;}
    setErrors((current)=>({...current,[log.id]:""}));
    return itemComments;
  },[comments]);

  async function decide(log:PendingLog,action:"approve"|"return"){
    const itemComments=itemCommentsFor(log);
    if(!itemComments) return;
    setActionError("");
    try {
      const body=action==="approve"?{color:colors[log.id]??"RED",itemComments}:{itemComments};
      await apiRequest(`/approvals/${log.id}/${action}`,{method:"POST",body:JSON.stringify(body)});
      const remaining=logs.filter((item)=>item.id!==log.id);
      setLogs(remaining);
      setTotal(Math.max(0,total-1));
      // 当前页已空：有上一页就回退，否则立即重取，避免「共 N 条待审」却显示暂无待审日志。
      if(remaining.length===0){
        if(page>1) setPage(page-1);
        else setReloadKey((value)=>value+1);
      }
    } catch {
      setActionError("审批操作失败，请刷新后重试");
    }
  }

  const totalPages=Math.max(1,Math.ceil(total/PAGE_SIZE));

  return <main className="page">
    <div className="page-head"><div><h1>待审日志</h1><p>日志提交后即可核查，满72小时后仍可核查，系统会发送逾期提醒。</p></div>{!loading&&!loadError&&total>0&&<span className="pending-count">共 {total} 条待审</span>}</div>
    {actionError&&<p className="form-error" role="alert">{actionError}</p>}
    {loading&&<section className="panel empty"><strong>正在加载待审日志…</strong></section>}
    {!loading&&loadError&&<section className="panel empty" role="alert"><strong>{loadError}</strong></section>}
    {!loading&&!loadError&&logs.length===0&&<section className="panel empty"><strong>暂无待审日志</strong></section>}
    {!loading&&!loadError&&logs.map((log)=><section className="panel review-card" key={log.id}>{log.isBackfill&&<p className="backfill-tag">补写</p>}<LetterLog items={log.items} employeeName={log.employeeName||log.employeeId} workDate={log.workDate} renderCommentColumn={(item,index)=>{const position=item.position??index+1;return <><ItemCommentThread steps={log.approvalSteps} itemPosition={position}/><label className="field item-comment-input"><span>本次批注</span><textarea aria-label={`事项 ${position} 批注`} value={comments[log.id]?.[position]??""} onChange={(event)=>setItemComment(log.id,position,event.target.value)}/></label></>;}}/>{errors[log.id]&&<p className="form-error" role="alert">{errors[log.id]}</p>}<fieldset className="color-choice"><legend>核查结果</legend><label><input type="radio" name={`color-${log.id}`} checked={(colors[log.id]??"RED")==="RED"} onChange={()=>setColors((current)=>({...current,[log.id]:"RED"}))}/><span>完成</span></label><label><input type="radio" name={`color-${log.id}`} checked={colors[log.id]==="GRAY"} onChange={()=>setColors((current)=>({...current,[log.id]:"GRAY"}))}/><span>未完成</span></label></fieldset><div className="form-actions"><button className="btn secondary" onClick={()=>void decide(log,"return")}>退回修改</button><button className="btn primary" onClick={()=>void decide(log,"approve")}>确认核查</button></div></section>)}
    {!loading&&!loadError&&total>0&&totalPages>1&&<div className="form-actions pager">
      <button className="btn secondary" disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</button>
      <span>第 {page} / {totalPages} 页</span>
      <button className="btn secondary" disabled={page>=totalPages} onClick={()=>setPage(page+1)}>下一页</button>
    </div>}
  </main>;
}
