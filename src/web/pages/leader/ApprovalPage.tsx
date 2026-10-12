import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client.js";
import { ItemCommentThread, type ApprovalStepView } from "../../components/logs/ApprovalProgress.js";
import { LetterLog, type LetterLogItem } from "../../components/logs/LetterLog.js";

interface PendingLog { id:string; employeeId:string; employeeName:string; workDate:string; items:(LetterLogItem&{position:number})[]; approvalSteps:ApprovalStepView[] }

export function ApprovalPage() {
  const [logs,setLogs]=useState<PendingLog[]>([]);
  const [colors,setColors]=useState<Record<string,"RED"|"GRAY">>({});
  const [comments,setComments]=useState<Record<string,Record<number,string>>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  useEffect(()=>{void apiRequest<{logs:PendingLog[]}>("/approvals/pending").then((result)=>setLogs(result.logs));},[]);
  function setItemComment(logId:string,itemPosition:number,comment:string){setComments((current)=>({...current,[logId]:{...current[logId],[itemPosition]:comment}}));}
  function itemCommentsFor(log:PendingLog){const itemComments=log.items.map((item)=>({itemPosition:item.position,comment:comments[log.id]?.[item.position]?.trim()??""}));if(itemComments.some((item)=>!item.comment)){setErrors((current)=>({...current,[log.id]:"请针对每一项工作填写批注"}));return null;}setErrors((current)=>({...current,[log.id]:""}));return itemComments;}
  async function decide(log:PendingLog,action:"approve"|"return"){const itemComments=itemCommentsFor(log);if(!itemComments)return;const body=action==="approve"?{color:colors[log.id]??"RED",itemComments}:{itemComments};await apiRequest(`/approvals/${log.id}/${action}`,{method:"POST",body:JSON.stringify(body)});setLogs((current)=>current.filter((item)=>item.id!==log.id));}
  return <main className="page"><div className="page-head"><div><p className="eyebrow">REVIEW QUEUE</p><h1>待审日志</h1><p>当天或次日核查，只选择红色完成或灰色未完成。</p></div></div>{logs.length===0?<section className="panel empty"><strong>暂无待审日志</strong></section>:logs.map((log)=><section className="panel review-card" key={log.id}><LetterLog items={log.items} employeeName={log.employeeName||log.employeeId} workDate={log.workDate} renderCommentColumn={(item,index)=>{const position=item.position??index+1;return <><ItemCommentThread steps={log.approvalSteps} itemPosition={position}/><label className="field item-comment-input"><span>本次批注</span><textarea aria-label={`事项 ${position} 批注`} value={comments[log.id]?.[position]??""} onChange={(event)=>setItemComment(log.id,position,event.target.value)}/></label></>;}}/>{errors[log.id]&&<p className="form-error" role="alert">{errors[log.id]}</p>}<fieldset className="color-choice"><legend>核查结果</legend><label><input type="radio" name={`color-${log.id}`} checked={(colors[log.id]??"RED")==="RED"} onChange={()=>setColors((current)=>({...current,[log.id]:"RED"}))}/><span>红色：已完成</span></label><label><input type="radio" name={`color-${log.id}`} checked={colors[log.id]==="GRAY"} onChange={()=>setColors((current)=>({...current,[log.id]:"GRAY"}))}/><span>灰色：未完成</span></label></fieldset><div className="form-actions"><button className="btn secondary" onClick={()=>void decide(log,"return")}>退回修改</button><button className="btn primary" onClick={()=>void decide(log,"approve")}>确认核查</button></div></section>)}</main>;
}
