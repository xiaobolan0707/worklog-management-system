import { useEffect,useState } from "react";
import { Link,useParams } from "react-router-dom";
import { apiRequest } from "../../api/client.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { ApprovalProgress,ItemCommentThread,type ApprovalStepView } from "../../components/logs/ApprovalProgress.js";
import { LetterLog,type LetterLogItem } from "../../components/logs/LetterLog.js";
interface LogDetail{employeeName:string;workDate:string;color:"GREEN"|"RED"|"GRAY"|null;items:(LetterLogItem&{position:number})[];approvalSteps:ApprovalStepView[]}
export function LogDetailPage(){const{id=""}=useParams();const[log,setLog]=useState<LogDetail|null>(null);useEffect(()=>{void apiRequest<{log:LogDetail}>(`/logs/${id}`).then((result)=>setLog(result.log));},[id]);if(!log)return <main className="page"><p>正在加载日志…</p></main>;return <main className="page"><div className="page-head"><div><p className="eyebrow">LOG DETAIL</p><h1>完整日志</h1><p><Link to="/leader/logs">返回日志查询</Link></p></div><StatusBadge color={log.color}/></div><section className="panel"><LetterLog items={log.items} employeeName={log.employeeName} workDate={log.workDate} renderCommentColumn={(item,index)=><ItemCommentThread steps={log.approvalSteps} itemPosition={item.position??index+1}/>}/><ApprovalProgress steps={log.approvalSteps}/></section></main>}
