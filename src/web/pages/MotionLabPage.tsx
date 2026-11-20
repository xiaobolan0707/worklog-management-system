import { useState, type ReactNode } from "react";

import { Icon } from "../components/Icon.js";
import {
  useToast, Skeleton, EmptyState, CountBadge, Drawer, Modal,
  Dropdown, Tooltip, Accordion, Segmented, Tabs, Steps
} from "../components/motion/index.js";

/* 说明：本页是系统内的组件实验室，所有示例都用真实组件与真实令牌，可直接点。 */

function Card({ id, title, usage, spec, tall = false, children }: {
  id: string;
  title: string;
  usage: ReactNode;
  spec: ReactNode;
  tall?: boolean;
  children: ReactNode;
}) {
  return (
    <article className="mp-card">
      <div className="mp-card-head"><span className="mp-card-id">#{id}</span><h3>{title}</h3></div>
      <p className="mp-card-use">{usage}</p>
      <div className={`mp-stage${tall ? " mp-stage-tall" : ""}`}>{children}</div>
      <div className="mp-card-foot">
        <p>{spec}</p>
        <a href={`https://showheyohtaki.github.io/motion-prompt/#${id}`} target="_blank" rel="noreferrer">原 demo ↗</a>
      </div>
    </article>
  );
}

const PERIODS = [
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" }
];
const BAR_SETS: number[][] = [
  [32, 52, 41, 68, 47, 86, 60],
  [58, 40, 86, 72, 94, 52, 78],
  [92, 66, 100, 58, 81, 96, 74]
];
const LOG_ROWS = ["09/12 周一 · 审批流联调", "09/11 周日 · 周报汇总", "09/10 周六 · 用例评审"];
const DEPARTMENTS = ["研发部", "产品部", "运营部", "不指定"];

export function MotionLabPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<number[]>([1, 2]);
  const [leaving, setLeaving] = useState<number[]>([]);
  const [count, setCount] = useState(0);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [department, setDepartment] = useState("");
  const [period, setPeriod] = useState("day");
  const [step, setStep] = useState(0);

  const reload = () => {
    if (loading) return;
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1600);
  };
  const removeRow = (id: number) => {
    if (leaving.includes(id)) return;
    setLeaving((current) => [...current, id]);
    window.setTimeout(() => {
      setRows((current) => current.filter((value) => value !== id));
      setLeaving((current) => current.filter((value) => value !== id));
    }, 300);
  };
  const periodIndex = Math.max(0, PERIODS.findIndex((option) => option.value === period));
  const barSet = BAR_SETS[periodIndex] ?? BAR_SETS[0] ?? [];

  return (
    <main className="page mp-lab">
      <div className="mp-lab-head">
        <div>
          <h1>动效组件</h1>
          <p>从 motion-prompt 挑出的 12 个候选，已换成本系统的纸感底 / 森林绿 / 单条缓动族。所有示例都可以点——<b>看的是节奏，不是样式</b>。其中 Toast、Skeleton、Segmented、EmptyState 已经接进真实业务页。</p>
        </div>
        <span className="mp-lab-tag">12 个候选 · 可交互 · MIT</span>
      </div>

      <section className="mp-lab-section">
        <h2><span>01</span>状态与反馈 · 让"等待、为空、完成"有话说</h2>
        <div className="mp-lab-grid">

          <Card id="056" title="Toast 轻提示" usage={<>接在<b>今日日志的保存 / 提交 / 删除</b>上，右下角确认结果，不打断手上的事。</>}
            spec={<>滑入 <code>240px / 350ms</code> easeOut · 停留 <code>1.8s</code>，底部细线线性收缩 · 滑出 350ms easeInOut</>}>
            <p className="mp-demo-note" style={{ marginTop: 0 }}>点下面的按钮，提示出现在整个窗口右下角。</p>
            <div className="mp-fake-row"><span>今日工作 · 4 项</span><button className="btn primary" type="button" onClick={() => toast.show("日志已保存")}>保存日志</button></div>
            <div className="mp-fake-row"><span>信息类结果</span><button className="btn secondary" type="button" onClick={() => toast.show("草稿已删除", "info")}>删除草稿</button></div>
          </Card>

          <Card id="069" title="Skeleton 骨架屏" usage={<>已替换 <b>AsyncState 的 loading</b>，所有列表 / 看板共用；占位块与真实行同尺寸。</>}
            spec={<>内容换占位 <code>150ms</code> 线性 · 光带 <code>160px</code> 每 <code>0.9s</code> 扫一次 · 内容回归 300ms 线性</>}>
            <div className="mp-demo-row"><span className="mp-demo-note">最近日志</span><button className="btn secondary" type="button" onClick={reload}>↻ 重新加载</button></div>
            <div style={{ marginTop: 10 }}>
              {loading
                ? <Skeleton rows={2} label="正在加载最近日志" />
                : <>
                    <div className="mp-fake-row"><span>张小明 · 09/12</span><span className="mp-demo-note">2.7 h</span></div>
                    <div className="mp-fake-row"><span>李梅 · 09/12</span><span className="mp-demo-note">1.4 h</span></div>
                  </>}
            </div>
          </Card>

          <Card id="072" title="Empty state 空态" usage={<>已替换 <b>AsyncState 的 empty</b>；空态不是"没东西"，是给下一步动作。</>}
            spec={<>行左移 <code>60px</code> 淡出 300ms · 空态淡入并升 <code>8px</code> 350ms · 插画用线稿不用彩色 emoji</>}>
            {rows.length === 0
              ? <EmptyState title="本月还没有日志" hint="写一条再回来看看。" actionLabel="写今天的第一条" onAction={() => setRows([1, 2])} />
              : <div>
                  <p className="mp-demo-note" style={{ marginTop: 0 }}>删掉两行，看空态怎么接手。</p>
                  {rows.map((id) => (
                    <div className={`mp-fake-row mp-em-row${leaving.includes(id) ? " out" : ""}`} key={id}>
                      <span>09/1{id} 日志 · 已通过</span>
                      <button className="btn secondary" type="button" aria-label="删除" onClick={() => removeRow(id)}>✕</button>
                    </div>
                  ))}
                </div>}
          </Card>

          <Card id="071" title="Badge 角标计数" usage={<>适合<b>侧栏「待我审批」</b>：新日志到达时数字 +1、弹一下、扩一圈波纹，只在这一刻抢注意力。</>}
            spec={<>首次出现 scale <code>0→1</code> 200ms · 每次新增 pop <code>1.3→1</code> 300ms · 波纹 500ms · 点铃铛清零 250ms</>}>
            <div className="mp-demo-row">
              <span className="mp-demo-note">工作空间 / 待我审批</span>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <button className="btn secondary" type="button" aria-label="通知" onClick={() => setCount(0)}><Icon name="bell" /></button>
                <span style={{ position: "absolute", top: -7, right: -7 }}><CountBadge count={count} label="待审批日志" onClear={() => setCount(0)} /></span>
              </span>
            </div>
            <div style={{ marginTop: 18 }}><button className="btn primary" type="button" onClick={() => setCount((value) => Math.min(9, value + 1))}>模拟收到新日志</button></div>
          </Card>

        </div>
      </section>

      <section className="mp-lab-section">
        <h2><span>02</span>内容与层级 · 把详情、确认、筛选从"跳页"改成"浮一层"</h2>
        <div className="mp-lab-grid">

          <Card id="050" title="Drawer 抽屉" usage={<>日志 / 审计详情从右侧滑入，列表不丢上下文，看完就关，少一次返回。</>}
            spec={<>滑入 <code>380ms</code> easeOut · 遮罩 <code>0.36</code> 同步 · 关闭 350ms easeInOut · 支持 Esc 与点遮罩</>}>
            {LOG_ROWS.map((row) => (
              <div className="mp-fake-row" key={row}><span>{row}</span><button className="btn secondary" type="button" onClick={() => setDrawer(row.slice(0, 5))}>查看</button></div>
            ))}
            <Drawer open={drawer !== null} title={drawer ? `${drawer} 日志详情` : "日志详情"} onClose={() => setDrawer(null)}>
              <p className="mp-demo-note">张小明 · 研发部 · 2.7 小时</p>
              <p className="mp-demo-note">完成审批流接口联调，补了 3 条边界用例：重复提交、撤回后再提交、跨部门审批人缺席。</p>
              <p className="mp-demo-note" style={{ color: "var(--forest)" }}>状态：已通过（李经理 18:20）</p>
              <button className="btn secondary" type="button" onClick={() => setDrawer(null)}>关闭</button>
            </Drawer>
          </Card>

          <Card id="049" title="Modal 弹窗" usage={<>审批通过 / 停用账号 / 重置密码这类必须停下确认的事：轻缩放，不要硬弹。</>}
            spec={<>遮罩 <code>0.42</code> · 窗口 <code>scale .9→1</code> + 淡入 320ms easeOut · 关闭 280ms</>}>
            <div className="mp-fake-row"><span>张小明 · 09/12</span><button className="btn primary" type="button" onClick={() => setModalOpen(true)}>审批</button></div>
            <div className="mp-fake-row"><span>李梅 · 09/12</span><span className="mp-demo-note">已通过</span></div>
            <div className="mp-fake-row"><span>王强 · 09/12</span><span className="mp-demo-note">待审批</span></div>
            <Modal open={modalOpen} title="通过这条日志？" onClose={() => setModalOpen(false)}
              actions={<><button className="btn secondary" type="button" onClick={() => setModalOpen(false)}>取消</button><button className="btn primary" type="button" onClick={() => { setModalOpen(false); toast.show("审批已通过"); }}>通过</button></>}>
              <p>通过后会计入本月工时与排行榜，30 天内可撤回。</p>
            </Modal>
          </Card>

          <Card id="053" title="Dropdown 下拉" usage={<>所属部门 / 角色 / 归档周期：原生 select 太素，换成带落点的列表，选中态才看得见。</>}
            spec={<>列表淡入并下落 <code>6px</code> 250ms easeOut · 箭头转 <code>180°</code> · 打开时边框 2px 绿，用内阴影不挤动布局</>} tall>
            <Dropdown label="所属部门" ariaLabel="所属部门" value={department} placeholder="请选择部门" options={DEPARTMENTS} onChange={(value) => { setDepartment(value); toast.show(`已选择：${value}`, "info"); }} />
            <p className="mp-demo-note" style={{ marginTop: 90 }}>当前值：{department || "—"}</p>
          </Card>

          <Card id="054" title="Tooltip 提示" usage={<>指标口径说明贴在指标旁边；页面底部那段"历史报表按当前部门统计"应该搬到这里。</>}
            spec={<>悬停 / 聚焦 <code>200ms</code> 淡入并升 <code>6px</code> · 离开 200ms 线性消失 · 深色气泡带下三角</>}>
            <p className="mp-metric-kicker">本月 · 研发部</p>
            <div className="mp-metric">1.8 天</div>
            <p className="mp-metric-note">较上月 −0.3 天</p>
            <div className="mp-metric-row"><span>平均响应时长</span><Tooltip text="从提交到首次审批的平均耗时，不含周末与法定假日。" /></div>
          </Card>

          <Card id="052" title="Accordion 折叠" usage={<>日志按周分组 / 系统设置分组：默认只展开最近一周，其余收起来先看标题。</>}
            spec={<>展开 <code>350ms</code> easeInOut，高度 34→92，下方行同步下推 · <b>同组只开一个</b>，避免多开顶出视口</>}>
            <Accordion initial={0} items={[
              { title: "本周 9/08 — 9/14", content: <>周一 2.7h · 审批流联调<br />周三 1.4h · 用例评审<br />周五 3.0h · 周报汇总</> },
              { title: "上周 9/01 — 9/07", content: <>3 条日志 · 8.6 小时<br />其中 1 条被退回补充</> },
              { title: "更早", content: <>共 42 条 · 归档于 9/01</> }
            ]} />
          </Card>

        </div>
      </section>

      <section className="mp-lab-section">
        <h2><span>03</span>切换与流程 · 指示块移动比内容自己换掉更好理解</h2>
        <div className="mp-lab-grid">

          <Card id="060" title="Segmented 分段控制" usage={<>已替换<b>公司总览的本月 / 本季 / 本年</b>：滑块 + 图表高度同步变化，切换的是同一组数据的视角。</>}
            spec={<>指示块 <code>250ms</code> 对称缓动 · 柱子同曲线一起动 · 新增令牌 <code>--ease-move</code>，避免"冲一下再停"</>}>
            <Segmented ariaLabel="统计周期" options={PERIODS} value={period} onChange={setPeriod} />
            <div className="mp-bars">
              {barSet.map((height, index) => <i key={index} className={index === 5 ? "hi" : ""} style={{ height: `${height}%` }} />)}
            </div>
            <div className="mp-bars-cap"><span>9/08</span><span>9/14</span></div>
          </Card>

          <Card id="057" title="Tabs 标签页" usage={<>日志卡片的概览 / 明细 / 附件：下划线滑过去，比按钮换色更像"同一块内容翻面"。</>}
            spec={<>下划线位置+宽度 <code>250ms</code> easeInOut · 旧面板 200ms 淡出 · 新面板延迟 100ms 淡入并升 8px</>}>
            <Tabs tabs={[
              { label: "概览", content: <><div className="mp-tab-row"><span>本周工时</span><b>7.1 h</b></div><div className="mp-tab-row"><span>提交条数</span><b>3 条</b></div><div className="mp-tab-row"><span>一次通过率</span><b>100%</b></div></> },
              { label: "明细", content: <><div className="mp-tab-row"><span>09/12 周一</span><b>2.7 h</b></div><div className="mp-tab-row"><span>09/10 周三</span><b>1.4 h</b></div><div className="mp-tab-row"><span>09/05 周五</span><b>3.0 h</b></div></> },
              { label: "附件", content: <><div className="mp-tab-row"><span>需求评审记录.pdf</span><b>240 KB</b></div><div className="mp-tab-row"><span>接口联调截图.png</span><b>1.1 MB</b></div></> }
            ]} />
          </Card>

          <Card id="068" title="Step 步骤指示" usage={<>日志审批链（提交 → 主管 → HR 备案 → 归档）：当前在哪一步、还剩几步，比状态文字清楚。</>}
            spec={<>线每步延伸 <code>1/3</code> / <code>300ms</code> easeInOut · 已完成圆点换对勾 · 不用百分比进度条，审批不是匀速的</>}>
            <Steps labels={["提交", "主管", "HR 备案", "归档"]} current={step} />
            <div className="mp-step-foot">
              <span>{["等待提交", "等待主管审批", "等待 HR 备案", "已归档"][step]}</span>
              <button className="btn secondary" type="button" onClick={() => setStep((value) => value === 3 ? 0 : value + 1)}>{step === 3 ? "重新开始" : "下一步"}</button>
            </div>
          </Card>

        </div>
      </section>

      <div className="mp-lab-foot">
        <b>已接进真实页面：</b>今日日志（#056 保存 / 提交 / 删除）、公司总览（#060 周期切换）、全站异步状态（#069 加载 / #072 空态）。其余组件已封装在 <code>src/web/components/motion/</code>，随时可以挂到对应页面。<br />
        <b>两个新令牌：</b><code>--ease-move: cubic-bezier(.45, 0, .25, 1)</code> 给位移类，<code>--dur-overlay: 320ms</code> 给抽屉 / 弹窗；原有的 <code>--ease-out</code> 只留给"出现"。全局 <code>prefers-reduced-motion</code> 规则会把这些动画全部关掉。<br />
        <b>授权：</b>元素以 MIT 发布，版权归 Shohei Ohtaki；本实现保留编号、原规格时长与原 demo 链接，落地时请一并保留归属行。
      </div>
    </main>
  );
}
