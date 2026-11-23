import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
const hooks=vi.hoisted(()=>({cursor:0,slots:[] as any[],effects:[] as (()=>void)[]}))
vi.mock('react',async original=>{
  const real=await original<typeof import('react')>()
  return {...real,useState:(initial:any)=>{
    const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]=typeof initial==='function'?initial():initial
    return [hooks.slots[i],(next:any)=>{hooks.slots[i]=typeof next==='function'?next(hooks.slots[i]):next}]
  },useRef:(initial:any)=>{const i=hooks.cursor++;return hooks.slots[i]??(hooks.slots[i]={current:initial})},useEffect:(fn:()=>void)=>{hooks.effects.push(fn)}}
})
import GenerationConfirm from '../GenerationConfirm'
import type { GenerationPlan } from '../GenerationConfirm'
import ReadingWorkflowPanel from '../ReadingWorkflowPanel'
import VideoGenerationPanel from '../VideoGenerationPanel'
import GenerationRecords from '../GenerationRecords'
import type { WorkflowStatus } from '../../api/client'
let tree:any,component:()=>any
function render(){hooks.cursor=0;hooks.effects=[];tree=component()}
function nodes(test:(n:any)=>boolean,node:any=tree):any[]{
  if(!node||typeof node!=='object')return []
  return [...(test(node)?[node]:[]),...[node.props?.children].flat(Infinity).filter(n=>n&&typeof n==='object').flatMap(n=>nodes(test,n))]
}
function text(node:any):string{return typeof node==='string'||typeof node==='number'?String(node):!node||typeof node!=='object'?'':[node.props?.children].flat(Infinity).map(text).join('')}
function button(label:string){const n=nodes(n=>n.type==='button'&&text(n)===label)[0];if(!n)throw new Error('missing '+label);return n}
const plan:GenerationPlan={title:'确认测试',pages:[8,12],services:['豆包可能收费','本机合成'],narration:'本机配音',reuse:['复用旧片段'],warnings:['失败不代表未收费']}
const status:WorkflowStatus={coverage:{complete:true,missing_page_nos:[],unanalyzed_page_nos:[],invalid_mapping:false,pages:[{page_no:8,shot_numbers:[1]}],note:'待复核'},vision:null,storyboard:{character_guide:'',shots:[{page_no:8,caption:'c',prompt:'p'}]},revision:1,approved:true,source_current:true,asset_id:null,tasks:[],clips:[],capabilities:{vision_configured:true,video_configured:true,composition_available:true,narration_available:true}}
beforeEach(()=>{hooks.cursor=0;hooks.slots=[];hooks.effects=[];vi.useFakeTimers()})
afterEach(()=>vi.useRealTimers())
function consent(){nodes(n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});render()}

describe('统一生成清单',()=>{
  it('默认未确认且清单包含页码、服务、配音、复用和未知费用',()=>{
    const submit=vi.fn();component=()=>GenerationConfirm({plan,onConfirm:submit,onCancel:vi.fn()});render()
    expect(button('确认清单并执行').props.disabled).toBe(true)
    expect(text(tree)).toContain('第 8 页、第 12 页');expect(text(tree)).toContain('金额未知');expect(text(tree)).toContain('复用旧片段')
    expect(submit).not.toHaveBeenCalled()
  })
  it('取消与 Esc 不会提交',()=>{
    const submit=vi.fn(),cancel=vi.fn();component=()=>GenerationConfirm({plan,onConfirm:submit,onCancel:cancel});render()
    button('取消，暂不执行').props.onClick();tree.props.onCancel({preventDefault:vi.fn()})
    expect(cancel).toHaveBeenCalledTimes(2);expect(submit).not.toHaveBeenCalled()
  })
  it('必须明确勾选；成功后关闭',async()=>{
    const submit=vi.fn(async()=>{}),cancel=vi.fn();component=()=>GenerationConfirm({plan,onConfirm:submit,onCancel:cancel});render()
    await button('确认清单并执行').props.onClick();expect(submit).not.toHaveBeenCalled()
    consent();expect(button('确认清单并执行').props.disabled).toBe(false)
    button('确认清单并执行').props.onClick();await Promise.resolve();await Promise.resolve()
    expect(submit).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('双击和提交期间 Esc 不重复执行或关闭',async()=>{
    let done!:()=>void
    const submit=vi.fn(()=>new Promise<void>(r=>{done=r})),cancel=vi.fn()
    component=()=>GenerationConfirm({plan,onConfirm:submit,onCancel:cancel});render();consent()
    const click=button('确认清单并执行').props.onClick;click();click();render()
    tree.props.onCancel({preventDefault:vi.fn()});expect(cancel).not.toHaveBeenCalled();expect(submit).toHaveBeenCalledTimes(1)
    done();await Promise.resolve()
  })
  it('页码或服务变更会撤销刚才的同意',()=>{
    let current=plan;component=()=>GenerationConfirm({plan:current,onConfirm:vi.fn(),onCancel:vi.fn()});render();consent()
    current={...plan,pages:[99]};render();expect(button('确认清单并执行').props.disabled).toBe(true)
    consent();current={...current,narration:'无配音'};render();expect(button('确认清单并执行').props.disabled).toBe(true)
  })
  it('结果不明时显示错误并禁止原地重复提交',async()=>{
    const submit=vi.fn(async()=>{throw new Error('网络超时')});component=()=>GenerationConfirm({plan,onConfirm:submit,onCancel:vi.fn()});render();consent()
    button('确认清单并执行').props.onClick();await Promise.resolve();await Promise.resolve();render()
    expect(text(tree)).toContain('网络超时');expect(button('确认清单并执行').props.disabled).toBe(true)
    button('确认清单并执行').props.onClick();expect(submit).toHaveBeenCalledTimes(1)
  })
  it('无书页不可确认，直接触发处理函数也不提交',()=>{
    const submit=vi.fn()
    component=()=>GenerationConfirm({plan:{...plan,pages:[]},onConfirm:submit,onCancel:vi.fn()});render();consent();expect(button('确认清单并执行').props.disabled).toBe(true)
    button('确认清单并执行').props.onClick();expect(submit).not.toHaveBeenCalled()
  })
})

describe('生成入口均先预览清单',()=>{
  async function workflow(value:WorkflowStatus=status,pages=[{page_no:8}]){
    const api={workflow:vi.fn(async()=>value),understandPages:vi.fn(async()=>{}),resumeVision:vi.fn(async()=>{}),reuseVision:vi.fn(async()=>{}),retryUncertainVision:vi.fn(async()=>{}),makeStoryboard:vi.fn(),saveStoryboard:vi.fn(),approveStoryboard:vi.fn(),generateBookVideo:vi.fn(async()=>{}),resumeBookVideo:vi.fn(async()=>{}),enableCloudInteractions:vi.fn(),cloudInteractionsEnabled:()=>false}
    component=()=>ReadingWorkflowPanel({runId:'r',pages,onReady:vi.fn(),api});render();hooks.effects[0]();await Promise.resolve();render();return api
  }
  it('图文理解按钮不直接调用模型，确认后才提交',async()=>{
    const api=await workflow();button('理解所选书页').props.onClick();render()
    expect(api.understandPages).not.toHaveBeenCalled()
    const modal=nodes(n=>n.type===GenerationConfirm)[0];expect(modal.props.plan.pages).toEqual([8])
    await modal.props.onConfirm();expect(api.understandPages).toHaveBeenCalledWith('r',[8],{fast_mode:true,concurrency:2})
  })
  it('长书完成一批后只选择未分析页，确认清单不含已分析页',async()=>{
    const value={...status,vision:[{page_no:8,summary:'s',scene:'s',entities:[],events:[],uncertain:false}],tasks:[{stage:'vision',job_id:'j',status:'SUCCEEDED',error_code:null,error_message:null}]}
    const api=await workflow(value,[{page_no:8},{page_no:9},{page_no:10}])
    expect(button('理解所选书页').props.disabled).toBe(true)
    button('选择下一批未分析页').props.onClick();render()
    expect(button('理解所选书页').props.disabled).toBe(true)
    const consentLabel=nodes(n=>n.type==='label'&&text(n).startsWith('我同意将所选'))[0]
    nodes(n=>n.type==='input',consentLabel)[0].props.onChange({target:{checked:true}});render()
    expect(button('理解所选书页').props.disabled).toBe(false)
    button('理解所选书页').props.onClick();render()
    const modal=nodes(n=>n.type===GenerationConfirm)[0]
    expect(modal.props.plan.pages).toEqual([9,10]);expect(api.understandPages).not.toHaveBeenCalled()
    await modal.props.onConfirm();expect(api.understandPages).toHaveBeenCalledWith('r',[9,10],{fast_mode:true,concurrency:2})
  })
  it('后续批次失败时禁用新的收费分析，仍显示已完成页数',async()=>{
    await workflow({...status,vision:[{page_no:8,summary:'s',scene:'s',entities:[],events:[],uncertain:false}],tasks:[{stage:'vision',job_id:'j',status:'SUCCEEDED',error_code:null,error_message:null},{stage:'vision_batch',job_id:'j2',status:'FAILED',error_code:'VISION_INTERRUPTED',error_message:'未完成'}]},[{page_no:8},{page_no:9}])
    expect(button('选择下一批未分析页').props.disabled).toBe(true)
    expect(button('理解所选书页').props.disabled).toBe(true)
    expect(text(tree)).toContain('已分析 1 / 2 页');expect(text(tree)).toContain('图文理解')
  })
  it('快速模式和并发设置进入确认清单及请求',async()=>{
    const api=await workflow()
    nodes(n=>n.type==='select'&&n.props['aria-label']==='同时分析页数')[0].props.onChange({target:{value:'3'}})
    const label=nodes(n=>n.type==='label'&&text(n).startsWith('快速模式'))[0]
    nodes(n=>n.type==='input',label)[0].props.onChange({target:{checked:false}});render()
    button('理解所选书页').props.onClick();render()
    const modal=nodes(n=>n.type===GenerationConfirm)[0]
    expect(modal.props.plan.services.join('')).toContain('保留模型默认思考模式')
    expect(modal.props.plan.services.join('')).toContain('3 页')
    await modal.props.onConfirm()
    expect(api.understandPages).toHaveBeenCalledWith('r',[8],{fast_mode:false,concurrency:3})
  })
  it('恢复清单只包含未发送页，刷新不自动收费',async()=>{
    const api=await workflow({...status,vision_resume_available:true,vision_progress:[
      {page_no:8,job_id:'j',status:'SUCCEEDED',diagnostics:{elapsed_ms:1234}},
      {page_no:9,job_id:'j',status:'UNCERTAIN',diagnostics:{error_code:'TIMEOUT'}},
      {page_no:10,job_id:'j',status:'PENDING',diagnostics:{}}],
      vision:[{page_no:8,summary:'s',scene:'s',entities:[],events:[],uncertain:false}],
      tasks:[{stage:'vision',job_id:'j',status:'FAILED',error_code:'VISION_INTERRUPTED',error_message:null}]},[{page_no:8},{page_no:9},{page_no:10}])
    expect(text(tree)).toContain('结果不明，请核对请求记录')
    expect(api.resumeVision).not.toHaveBeenCalled()
    button('继续未发送书页').props.onClick();render()
    const modal=nodes(n=>n.type===GenerationConfirm)[0]
    expect(modal.props.plan.pages).toEqual([10])
    await modal.props.onConfirm()
    expect(api.resumeVision).toHaveBeenCalledWith('r')
    expect(api.understandPages).not.toHaveBeenCalled()
  })
  it('已有相同书页分析可免费复用，不触发收费请求',async()=>{
    const api=await workflow({...status,reusable_vision_page_nos:[2],vision_progress:[
      {page_no:2,job_id:'j',status:'UNCERTAIN',diagnostics:{}}],
      tasks:[{stage:'vision',job_id:'j',status:'FAILED',error_code:'VISION_INTERRUPTED',error_message:null}]},[{page_no:2}])
    button('免费复用已有分析：第 2 页').props.onClick()
    await Promise.resolve()
    expect(api.reuseVision).toHaveBeenCalledWith('r')
    expect(api.retryUncertainVision).not.toHaveBeenCalled()
  })
  it('没有可复用结果时，结果不明页经过收费确认才重试',async()=>{
    const api=await workflow({...status,reusable_vision_page_nos:[],vision_progress:[
      {page_no:2,job_id:'j',status:'UNCERTAIN',diagnostics:{}}],
      tasks:[{stage:'vision',job_id:'j',status:'FAILED',error_code:'VISION_INTERRUPTED',error_message:null}]},[{page_no:2}])
    button('核对后重新分析结果不明页：第 2 页').props.onClick();render()
    expect(api.retryUncertainVision).not.toHaveBeenCalled()
    const modal=nodes(n=>n.type===GenerationConfirm)[0]
    expect(modal.props.plan.pages).toEqual([2])
    expect(modal.props.plan.warnings.join('')).toContain('再次提交可能重复计费')
    await modal.props.onConfirm()
    expect(api.retryUncertainVision).toHaveBeenCalledWith('r',[2],{fast_mode:true,concurrency:2})
  })
  it('多页视频在清单中显示配音选择，确认后才提交',async()=>{
    const api=await workflow();button('一键生成全部视频').props.onClick();render()
    expect(api.generateBookVideo).not.toHaveBeenCalled()
    const modal=nodes(n=>n.type===GenerationConfirm)[0];expect(modal.props.plan.narration).toContain('添加本机中文配音')
    await modal.props.onConfirm();expect(api.generateBookVideo).toHaveBeenCalledWith('r',true)
  })
  it('恢复也需清单授权，沿用首次配音选择',async()=>{
    const api=await workflow({...status,narration:true,tasks:[{stage:'book_video',job_id:'j',status:'FAILED',error_code:null,error_message:null}],clips:[{page_no:8,submitted:1,downloaded:0,submission_started:1}]})
    button('继续生成剩余视频').props.onClick();render();expect(api.resumeBookVideo).not.toHaveBeenCalled()
    const modal=nodes(n=>n.type===GenerationConfirm)[0];expect(modal.props.plan.narration).toContain('本机中文配音')
    await modal.props.onConfirm();expect(api.resumeBookVideo).toHaveBeenCalledWith('r')
  })
  it('配音默认开启；组件未就绪时阻止提交，不静默降为无声视频',async()=>{
    const api=await workflow({...status,capabilities:{...status.capabilities,narration_available:false}})
    const label=nodes(n=>n.type==='label'&&text(n).startsWith('添加本机中文配音'))[0]
    expect(nodes(n=>n.type==='input',label)[0].props.checked).toBe(true)
    const consent=nodes(n=>n.type==='label'&&text(n).startsWith('我确认分镜已经检查'))[0]
    nodes(n=>n.type==='input',consent)[0].props.onChange({target:{checked:true}});render()
    expect(button('一键生成全部视频').props.disabled).toBe(true)
    button('一键生成全部视频').props.onClick();render()
    await expect(nodes(n=>n.type===GenerationConfirm)[0].props.onConfirm()).rejects.toThrow('本机中文配音尚未就绪')
    expect(api.generateBookVideo).not.toHaveBeenCalled()
  })
  it('主人明确取消配音后生成无声视频',async()=>{
    const api=await workflow()
    const label=nodes(n=>n.type==='label'&&text(n).startsWith('添加本机中文配音'))[0]
    nodes(n=>n.type==='input',label)[0].props.onChange({target:{checked:false}});render()
    button('一键生成全部视频').props.onClick();render()
    const modal=nodes(n=>n.type===GenerationConfirm)[0]
    expect(modal.props.plan.narration).toBe('不包含')
    await modal.props.onConfirm();expect(api.generateBookVideo).toHaveBeenCalledWith('r',false)
  })
  it('漏页时禁止确认和整书生成，不能绕过确认弹窗',async()=>{
    const api=await workflow({...status,approved:false,coverage:{complete:false,missing_page_nos:[9],unanalyzed_page_nos:[9],invalid_mapping:false,pages:[{page_no:8,shot_numbers:[1]},{page_no:9,shot_numbers:[]}],note:'缺页'}})
    expect(text(tree)).toContain('第 9 页 → 尚未覆盖')
    expect(button('我已检查内容，确认当前分镜').props.disabled).toBe(true)
    expect(button('一键生成全部视频').props.disabled).toBe(true)
    button('一键生成全部视频').props.onClick();render()
    await expect(nodes(n=>n.type===GenerationConfirm)[0].props.onConfirm()).rejects.toThrow('分镜或书页已变化')
    expect(api.generateBookVideo).not.toHaveBeenCalled()
  })
  it('页码完整仍需人工逐页语义复核后确认',async()=>{
    const api=await workflow({...status,approved:false})
    expect(button('我已检查内容，确认当前分镜').props.disabled).toBe(true)
    const check=nodes(n=>n.type==='label'&&text(n).includes('我已逐页核对分镜'))[0]
    nodes(n=>n.type==='input',check)[0].props.onChange({target:{checked:true}});render()
    expect(button('我已检查内容，确认当前分镜').props.disabled).toBe(false)
    await button('我已检查内容，确认当前分镜').props.onClick()
    expect(api.approveStoryboard).toHaveBeenCalledWith('r',1,true)
  })
  it('合并连续镜头保留全部来源页及内容，保存前不能确认',async()=>{
    const api=await workflow({...status,approved:false,storyboard:{character_guide:'',shots:[{page_no:8,caption:'小熊醒来',prompt:'睁眼'},{page_no:9,caption:'无字页：小熊开门',prompt:'走向门外'}]}})
    button('与下一镜合并并保留来源页').props.onClick();render()
    expect(button('我已检查内容，确认当前分镜').props.disabled).toBe(true)
    await button('保存分镜修改').props.onClick()
    expect(api.saveStoryboard).toHaveBeenCalledWith('r',1,expect.objectContaining({shots:[expect.objectContaining({page_no:8,source_page_nos:[8,9],caption:'小熊醒来；无字页：小熊开门',prompt:'睁眼；接着表现：走向门外'})]}))
  })
  it('单页恢复不直接提交，使用原页而非当前页',async()=>{
    const api={videoStatus:vi.fn(async()=>({status:'FAILED' as const,page_no:12,can_resume:true})),generateVideo:vi.fn(),resumeVideo:vi.fn(async()=>({status:'QUEUED' as const}))}
    component=()=>VideoGenerationPanel({runId:'r',pages:[{page_no:8}],onReady:vi.fn(),api});render();hooks.effects[0]();await Promise.resolve();render()
    button('继续查询原任务（不重新生成）').props.onClick();render();expect(api.resumeVideo).not.toHaveBeenCalled()
    const modal=nodes(n=>n.type===GenerationConfirm)[0];expect(modal.props.plan.pages).toEqual([12]);expect(modal.props.plan.services.join()).toContain('不重新上传书页或动作描述')
    await modal.props.onConfirm();expect(api.resumeVideo).toHaveBeenCalledTimes(1);expect(api.generateVideo).not.toHaveBeenCalled()
  })
  it('一次确认覆盖全部分镜和跨页来源，只提交一个整书任务，双击不会重复提交',async()=>{
    const shots=[{page_no:8,source_page_nos:[8,9],caption:'两页故事',prompt:'连续动作'},{page_no:10,caption:'结尾',prompt:'挥手'}]
    const api=await workflow({...status,storyboard:{character_guide:'',shots}},[{page_no:8},{page_no:9},{page_no:10}])
    expect(nodes(n=>n.type==='button'&&text(n)==='生成单页视频')).toHaveLength(0)
    const label=nodes(n=>n.type==='label'&&text(n).startsWith('我确认分镜已经检查'))[0]
    nodes(n=>n.type==='input',label)[0].props.onChange({target:{checked:true}});render()
    expect(button('一键生成全部视频').props.disabled).toBe(false)
    button('一键生成全部视频').props.onClick();render()
    const modal=nodes(n=>n.type===GenerationConfirm)[0]
    expect(modal.props.plan.title).toBe('确认生成全部视频')
    expect(modal.props.plan.pages).toEqual([8,9,10])
    expect(api.generateBookVideo).not.toHaveBeenCalled()
    await Promise.all([modal.props.onConfirm(),modal.props.onConfirm().catch(()=>{})])
    expect(api.generateBookVideo).toHaveBeenCalledExactlyOnceWith('r',true)
  })
  it('没有历史单页任务时不显示单页入口',async()=>{
    const api={videoStatus:vi.fn(async()=>({status:'NOT_STARTED' as const})),resumeVideo:vi.fn()}
    component=()=>VideoGenerationPanel({runId:'r',pages:[{page_no:8}],onReady:vi.fn(),api});render();hooks.effects[0]();await Promise.resolve();render()
    expect(tree).toBeNull();expect(api.resumeVideo).not.toHaveBeenCalled()
  })
  it('记录区显示真实状态与未知费用，不把任务数当计费次数',async()=>{
    const api={generationRecords:vi.fn(async()=>({book_id:'b',records:[{job_id:'j',run_id:'r',stage:'book_video',status:'FAILED',page_nos:[8,12],page_scope:'submitted',narration:true,created_at:'2026-11-19',error_code:'VIDEO_TIMEOUT',submitted_count:1,downloaded_count:0,uncertain_count:1,completed_vision_calls:null,amount:null}],amount:null,billing_note:'无账单，不是扣费次数'} as const))}
    component=()=>GenerationRecords({bookId:'b',api:api as any});render();hooks.effects[0]();await Promise.resolve();render()
    expect(text(tree)).toContain('多页视频 · 失败');expect(text(tree)).toContain('金额未知');expect(text(tree)).toContain('提交结果不明 1');expect(text(tree)).toContain('本机中文配音')
    expect(button('导出生成记录').props.disabled).toBe(false)
  })
  it('记录读取失败不伪装为空记录，不产生写操作',async()=>{
    const api={generationRecords:vi.fn(async()=>{throw new Error('断网')})}
    component=()=>GenerationRecords({bookId:'b',api});render();hooks.effects[0]();await Promise.resolve();await Promise.resolve();render()
    expect(text(tree)).toContain('读取失败：断网');expect(text(tree)).not.toContain('尚无生成任务记录')
    expect(button('导出生成记录').props.disabled).toBe(true)
  })
})
