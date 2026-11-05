import { useState } from 'react'
import BackendWorkbench from '../components/BackendWorkbench'
import { Badge, Button, Icon } from '../components/ui'
import type { Navigate } from '../app/types'

export default function SettingsPage({navigate,onReset}:{navigate:Navigate;onReset:()=>void}){
  const [reset,setReset]=useState(false)
  return <div className="page-content settings-page">
    <div className="page-heading"><div><p className="eyebrow">BEHIND YOUR READING SPACE</p><h1>把每一个状态，讲清楚。</h1><p className="page-description">本地演示、实际接口与模型能力，各有可检查的边界。</p></div><Badge tone="amber">主流程模拟 · A 接口可联调</Badge></div>
    <BackendWorkbench/>
    <section className="form-card"><div className="card-title"><Icon name="lock"/><h2>数据和演示会话</h2></div>
      <p className="settings-copy">主流程书架、笔记和分享保存在当前浏览器会话。用户选择的图片只在内存预览，刷新后需重新导入。模拟分享仅供同一会话预览，不发布到互联网。</p>
      <p className="settings-copy">上方独立联调区域会实际创建后端对象；清空本页或重置演示不会删除已创建的后端图书。OCR/VLM、视频生成、录音/ASR、点击推理和真实笔记分享全链路仍待接入。</p>
      {reset?<div className="reset-confirm"><p>重置会清除主流程的本地模拟修改、笔记审核和分享。请先导出需要的阅读历史。</p><Button onClick={()=>{onReset();setReset(false)}}>确认重置演示</Button><Button variant="ghost" onClick={()=>setReset(false)}>取消</Button></div>:<Button variant="secondary" onClick={()=>setReset(true)}>重置本地演示</Button>}
    </section>
    <section className="form-card settings-delivery"><h2>推荐演示路线</h2><ol><li>导入原创示例，调整页序并检查文字。</li><li>确认图书类型，查看模拟生成阶段与失败重试。</li><li>完成内容复核，进入阅读页提问、点击、查看证据。</li><li>编辑笔记，主人审核后创建限时分享并撤销。</li><li>打开历史，按页码或时间跳转，导出记录。</li></ol><Button variant="secondary" onClick={()=>navigate('import')}>开始演示<Icon name="arrow" size={16}/></Button></section>
  </div>
}
