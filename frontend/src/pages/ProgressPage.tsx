import type { WorkflowProps } from '../app/types'
import { Badge, Button, Icon } from '../components/ui'

const stages = [
  { title: '图文解析', subtitle: '整理书页文字与画面信息', icon: 'image' },
  { title: '分类与结构', subtitle: '使用主人确认的图书类型', icon: 'book' },
  { title: '阅读脚本', subtitle: '编排叙事与来源页码', icon: 'note' },
  { title: '视频与配音', subtitle: '生成片段、旁白和字幕', icon: 'spark' },
  { title: '笔记草稿', subtitle: '整理摘要、人物与概念', icon: 'note' },
  { title: '主人复核', subtitle: '检查内容与适龄提示', icon: 'check' },
]

export default function ProgressPage({ book, job, state, setState, setJob, updateBook, onGenerate, onOpenPagesOnly, navigate, notify }: WorkflowProps) {
  const running = job.status === 'running'
  const failed = job.status === 'failed'
  const ready = job.status === 'ready'
  const review = job.status === 'review'
  const currentStage = Math.min(5, Math.max(0, job.stage))
  const progress = Math.max(0, Math.min(100, job.progress))
  function failDemo() {
    setJob(current => ({ ...current, status: 'failed', error: 'DEMO_STAGE_TIMEOUT：模拟视频阶段超时。已保留原图和校对记录，可以重试。', events: [...current.events, { stage: stages[currentStage].title, message: '模拟失败：阶段超时，任务停止。', time: new Date().toISOString() }] }))
    notify('已切换到模拟失败；可检查错误提示并重试。')
  }
  function approve() {
    updateBook(current => ({ ...current, safety_reviewed: true, status: 'READY' }))
    setJob(current => ({ ...current, status: 'ready', stage: 5, progress: 100, error: null, events: [...current.events, { stage: '主人复核', message: '主人已完成本地原型的内容复核。', time: new Date().toISOString() }] }))
    notify('本地内容复核已确认，可查看演示阅读结果。')
  }
  const notSuccess = state !== 'success'
  return <div className="page-content workflow-page"><div className="page-heading wf-heading"><div><p className="eyebrow">A STORY IS TAKING SHAPE</p><h1>让故事，慢慢长出新的模样。</h1><p className="page-description">《{book.title}》 · 每一步都有记录，遇到问题也能找到来处。</p></div><Badge tone={book.origin === 'mock' ? 'amber' : 'green'}>{book.origin === 'mock' ? '模拟流程 · 非真实模型生成' : '真实任务'}</Badge></div>
    {notSuccess ? <section className={`state-panel state-${state} wf-state`} role={state === 'error' ? 'alert' : 'status'} aria-live="polite"><span className="state-icon"><Icon name={state === 'error' ? 'alert' : 'clock'} size={30}/></span><h2>{state === 'loading' ? '正在读取任务进度' : state === 'empty' ? '还没有生成任务' : '任务进度暂时不可用'}</h2><p>{state === 'loading' ? '请稍候，正在打开本次运行记录。' : state === 'empty' ? '完成书页校对与类型确认后，再开始生成。' : '模拟查询失败，可重新加载；不会静默重启任务。'}</p>{state !== 'loading' && <Button variant="secondary" onClick={() => state === 'empty' ? navigate('classification', book.id) : setState('success')}>{state === 'empty' ? '去确认图书类型' : '重新加载'}<Icon name="arrow" size={17}/></Button>}</section> : <>
      <section className={`progress-hero ${failed ? 'has-failed' : ready ? 'is-ready' : ''}`} aria-live="polite"><div className="progress-hero-copy"><span className="progress-symbol"><Icon name={failed ? 'alert' : ready ? 'check' : review ? 'book' : 'spark'} size={30}/></span><div><p className="wf-overline">{failed ? '需要处理' : ready ? '本次流程已完成' : review ? '等待主人复核' : running ? '任务处理中' : '准备就绪'}</p><h2>{failed ? '这一段还没完成，我们可以再试一次。' : ready ? '阅读空间已经准备好了。' : review ? '最后一步，把内容交给你把关。' : running ? `${stages[currentStage].title}正在进行…` : '确认图书后，开启这段阅读。'}</h2><p>{book.origin === 'mock' ? '当前为本地演示状态，进度与日志不代表真实模型运行。' : '以服务端任务状态为准，完成后仍需要主人复核内容。'}</p></div></div><div className="progress-value"><strong>{ready ? '100' : Math.round(progress)}<small>%</small></strong><span>{failed ? '已暂停' : ready ? '可查看结果' : review ? '等待复核' : '整体进度'}</span></div><div className="progress-track" role="progressbar" aria-label="整体任务进度" aria-valuenow={ready ? 100 : progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${ready ? 100 : progress}%` }}/></div></section>
      {failed && <div className="wf-error progress-error" role="alert"><Icon name="alert" size={21}/><div><strong>生成任务已明确停止</strong><p>{job.error ?? '未知错误，请保留本次运行记录后重试。'}</p><Button variant="secondary" onClick={onGenerate}>重试本次生成<Icon name="arrow" size={16}/></Button>{job.server && onOpenPagesOnly && <Button variant="ghost" onClick={onOpenPagesOnly}>先用校对文字做书页问答<Icon name="book" size={16}/></Button>}</div></div>}
      <div className="progress-layout"><section className="wf-card progress-stages"><div className="wf-card-heading"><h2>本次阅读的六个步骤</h2><span>{book.page_count} 页</span></div><ol>{stages.map((stage, index) => { const completed = ready || index < currentStage || (review && index < 5); const active = !failed && !ready && index === currentStage; return <li key={stage.title} className={`${completed ? 'completed' : ''} ${active ? 'current' : ''} ${failed && index === currentStage ? 'failed' : ''}`}><span className="stage-icon"><Icon name={completed ? 'check' : failed && index === currentStage ? 'alert' : stage.icon} size={20}/></span><div><h3>{stage.title}</h3><p>{stage.subtitle}</p></div><Badge tone={completed ? 'green' : failed && index === currentStage ? 'amber' : active ? 'purple' : 'neutral'}>{completed ? '已完成' : failed && index === currentStage ? '失败' : review && index === 5 ? '待审核' : active ? '进行中' : '等待中'}</Badge></li> })}</ol></section>
      <aside className="wf-card run-details"><div className="wf-card-heading"><h2>有迹可循的阅读</h2><Icon name="note" size={19}/></div><dl><div><dt>图书</dt><dd>{book.title}</dd></div><div><dt>运行标识</dt><dd className="mono-id">{job.run_id ?? book.run_id ?? '尚未创建'}</dd></div><div><dt>任务标识</dt><dd className="mono-id">{book.job_id ?? '本地原型任务'}</dd></div><div><dt>素材来源</dt><dd>{book.authorization_ref || '待补充'}</dd></div><div><dt>数据来源</dt><dd>{book.origin === 'mock' ? '原创模拟内容' : '真实接口返回'}</dd></div></dl><div className="wf-private"><Icon name="lock" size={17}/><span>笔记仍为私密草稿，内容复核与笔记审核是两个独立步骤。</span></div>{running && book.origin === 'mock' && <Button variant="ghost" onClick={failDemo}><Icon name="alert" size={15}/>体验一次模拟失败</Button>}{job.status === 'idle' && <Button onClick={() => navigate('classification', book.id)}>返回分类确认<Icon name="arrow" size={17}/></Button>}</aside></div>
      {review && <section className="review-gate"><div><span className="section-number"><Icon name="check" size={16}/></span><h2>主人内容复核</h2></div><p>请检查原书忠实度、来源引用、年龄适配和不当内容。当前是演示结果；确认只记录本地原型状态，不代表真实内容安全审核。</p><div className="wf-actions"><Button variant="secondary" onClick={() => navigate('review', book.id)}>返回检查原书</Button><Button onClick={approve}>确认本次内容复核<Icon name="check" size={17}/></Button></div></section>}
      {ready && <div className="wf-next-bar"><div><strong>{book.origin === 'mock' ? '模拟流程已完成，继续查看演示结果。' : '任务已完成，继续查看阅读结果。'}</strong><p>播放界面会保留数据来源、适龄提示和引用证据。</p></div><div className="wf-actions"><Button variant="secondary" onClick={() => navigate('notes', book.id)}>查看笔记草稿<Icon name="note" size={17}/></Button><Button onClick={() => navigate('reader', book.id)}>进入互动伴读<Icon name="arrow" size={17}/></Button></div></div>}
      <section className="wf-card run-log"><div className="wf-card-heading"><h2>运行记录</h2><span>{job.events.length} 条</span></div>{job.events.length ? <ol>{job.events.map((event, index) => <li key={`${event.time}-${index}`}><time>{Number.isNaN(Date.parse(event.time)) ? event.time : new Date(event.time).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time><strong>{event.stage}</strong><span>{event.message}</span></li>)}</ol> : <p className="wf-small">尚无运行记录。确认分类并开始任务后，这里会显示逐阶段事件。</p>}</section>
    </>}
  </div>
}
