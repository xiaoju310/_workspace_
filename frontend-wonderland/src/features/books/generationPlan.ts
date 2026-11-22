import type { GenerationPlan } from '../../components/GenerationConfirm'
import type { WorkflowStatus } from '../../api/client'
export function workflowPlan(kind:'vision'|'video'|'resume',value:WorkflowStatus,pages:number[],narration:boolean):GenerationPlan {
  const resume=kind==='resume'
  const clips=value.clips
  const downloaded=clips.filter(c=>c.downloaded).map(c=>c.page_no)
  const submitted=clips.filter(c=>c.submitted&&!c.downloaded).map(c=>c.page_no)
  const uncertain=clips.filter(c=>c.submission_started&&!c.submitted).map(c=>c.page_no)
  const fresh=pages.filter(n=>!clips.some(c=>c.page_no===n&&(c.submitted||c.submission_started||c.downloaded)))
  const list=(ns:number[])=>ns.length?ns.map(n=>`第 ${n} 页`).join('、'):'无'
  return {
    title:kind==='vision'?'确认图文理解':resume?'确认恢复多页视频':'确认多页视频生成',pages,
    services:kind==='vision'?['将所选书页图片与校对文字发送到火山方舟豆包视觉模型，按页请求，可能收费。','结果保存到当前后端，不覆盖人工校对文字。']:resume?['有任务凭据的片段只向火山方舟查询原任务并下载产物，不重新提交书页或生成请求。','仅尚未提交的片段可能把已确认分镜、角色设定和相关书页发送给豆包视频模型，约每页 5 秒，可能新增费用。','下载、合成及所选配音由本机完成，不调用收费合成或语音服务。']:['将已确认分镜、角色设定及相关书页发送到火山方舟豆包视频模型，每页约 5 秒，多个片段可能分别收费。','下载及合成本机完成，不调用收费合成服务。'],
    narration:kind==='vision'?'不包含':resume?(value.narration===undefined?'沿用首次选择（旧服务未返回配音状态，不推断）':value.narration?'沿用首次选择：本机中文配音，不调用收费语音服务':'沿用首次选择：无配音'):narration?'添加本机中文配音，不调用收费语音服务':'不包含',
    reuse:kind==='vision'?['每批最多 12 页，只处理本次列出的未分析页；已分析页复用，不再次发送。']:resume?[`已下载，校验通过后复用文件：${list(downloaded)}`,`已提交，继续查询原任务：${list(submitted)}`,`尚未提交，恢复后可能新建收费片段：${list(fresh)}`,`提交结果不明（后端会阻止恢复，需先核对）：${list(uncertain)}`]:['复用已确认分镜；本次不重新调用视觉理解模型。','同一运行已提交的片段不会自动重发。'],
    warnings:[resume?'恢复不是全部免费：尚未提交的片段可能收费；查询/下载沿用原任务，不等于原任务未收费。':'提交前请核对书页；不要因网络超时而创建新的运行重复生成。','仅记录本书生成流程，不含问答、认物的交互费用。']
  }
}
