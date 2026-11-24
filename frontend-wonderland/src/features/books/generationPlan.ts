import type { GenerationPlan } from '../../components/GenerationConfirm'
import type { WorkflowStatus } from '../../api/client'
export function workflowPlan(kind:'vision'|'vision-resume'|'vision-retry'|'video'|'resume',value:WorkflowStatus,pages:number[],narration:boolean,options?:{fast_mode:boolean;concurrency:number}):GenerationPlan {
  if(kind==='vision-resume')return {title:'确认继续未发送书页',pages,
    services:['仅将确认未发送的书页及校对文字发送到豆包，可能收费；沿用原批次的模式和并发设置。'],narration:'不包含',
    reuse:['成功结果直接复用；结果不明页保持阻止重发，不将超时视为未收费。'],warnings:['本次只恢复最早一个有未发送页的失败批次；不会自动重发结果不明页。']}
  if(kind==='vision-retry')return {title:'确认重新分析结果不明页',pages,
    services:[`将所选 ${pages.length} 页再次发送到豆包，可能再次收费；本次${options?.fast_mode===false?'保留模型默认思考模式':'使用快速模式'}，同时最多处理 ${options?.concurrency??2} 页。`],
    narration:'不包含',reuse:['已保存的页不会重发。'],
    warnings:['这些页原请求的处理和计费结果无法确认。请先核对供应商请求记录；再次提交可能重复计费。']}
  const resume=kind==='resume'
  const clips=value.clips
  const downloaded=clips.filter(c=>c.downloaded).map(c=>c.page_no)
  const submitted=clips.filter(c=>c.submitted&&!c.downloaded).map(c=>c.page_no)
  const uncertain=clips.filter(c=>c.submission_started&&!c.submitted).map(c=>c.page_no)
  const fresh=pages.filter(n=>!clips.some(c=>c.page_no===n&&(c.submitted||c.submission_started||c.downloaded)))
  const list=(ns:number[])=>ns.length?ns.map(n=>`第 ${n} 页`).join('、'):'无'
  return {
    title:kind==='vision'?'确认图文理解':resume?'确认继续生成剩余视频':'确认生成全部视频',pages,
    services:kind==='vision'?['将所选书页图片与校对文字发送到火山方舟豆包视觉模型，按页请求，可能收费。',`本次${options?.fast_mode===false?'保留模型默认思考模式':'使用快速模式'}，同时最多处理 ${options?.concurrency??2} 页。结果逐页保存，不覆盖人工校对文字。`]:resume?['有任务凭据的片段只向火山方舟查询原任务并下载产物，不重新提交书页或生成请求。','仅尚未提交的片段可能把已确认分镜、角色设定和相关书页发送给豆包视频模型，约每页 5 秒，可能新增费用。','下载及合成由本机完成；配音沿用首次设置，在线女声会外发旁白文字，旧本机配音不会自动切换。']:['一次确认后自动处理全部已确认分镜，无需逐页操作。相关书页、角色设定和动作描述将发送到火山方舟豆包视频模型，每个分镜约 5 秒，片段可能分别收费。','下载及合成本机完成，不调用收费合成服务。'],
    narration:kind==='vision'?'不包含':resume?(value.narration===undefined?'沿用首次选择（旧服务未返回配音状态，不推断）':value.narration?(value.narration_provider==='edge_neural'?'沿用首次选择：柔和中文女声，旁白文字发送到微软在线语音服务，需联网':'沿用首次选择：本机中文配音（旧任务），不会自动更换音色'):'沿用首次选择：无配音'):narration?'添加柔和中文女声（晓晓，稍慢语速、稍低音调）；旁白文字会发送到微软在线语音服务（edge-tts），需联网，失败不回退机械音':'不包含',
    reuse:kind==='vision'?['每批最多 12 页，只处理本次列出的未分析页；已分析页复用，不再次发送。']:resume?[`已下载，校验通过后复用文件：${list(downloaded)}`,`已提交，继续查询原任务：${list(submitted)}`,`尚未提交，恢复后可能新建收费片段：${list(fresh)}`,`提交结果不明（后端会阻止恢复，需先核对）：${list(uncertain)}`]:['复用已确认分镜；本次不重新调用视觉理解模型。','同一运行已提交的片段不会自动重发。'],
    warnings:[resume?'恢复不是全部免费：尚未提交的片段可能收费；查询/下载沿用原任务，不等于原任务未收费。':'提交前请核对书页；不要因网络超时而创建新的运行重复生成。','仅记录本书生成流程，不含问答、认物的交互费用。']
  }
}
