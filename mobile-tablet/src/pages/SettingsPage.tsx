import { useState } from 'react'
import BackendWorkbench from '../components/BackendWorkbench'
import { Badge, Button, Icon } from '../components/ui'
import type { Navigate } from '../app/types'

export default function SettingsPage({navigate,onReset,appMode='demo',backendToken=''}:{navigate:Navigate;onReset:()=>void;appMode?:'live'|'demo';backendToken?:string}){
  const [reset,setReset]=useState(false)
  return <div className="page-content settings-page">
    <div className="page-heading"><div><p className="eyebrow">BEHIND YOUR READING SPACE</p><h1>把每一个状态，讲清楚。</h1><p className="page-description">本地演示、实际接口与模型能力，各有可检查的边界。</p></div><Badge tone={appMode === 'live' ? 'green' : 'amber'}>{appMode === 'live' ? '真实主流程 · 示例仍为模拟' : '本地演示模式'}</Badge></div>
    <BackendWorkbench token={backendToken}/>
    <section className="form-card"><div className="card-title"><Icon name="lock"/><h2>数据和演示会话</h2></div>
      <p className="settings-copy">书架和当前页面状态保存在浏览器会话；自行导入的书页图片只在内存预览，刷新后需重新导入。演示模式的本地分享不提供真实权限控制。</p>
      <p className="settings-copy">真实模式中的新书主流程以及上方联调区域可请求后端；是否获得分析、视频、语音或分享结果取决于实际服务和权限。重置浏览器会话不会删除后端已创建的对象。演示内容不会自动变成真实结果。</p>
      {reset?<div className="reset-confirm"><p>重置会清除当前浏览器会话中的图书、笔记审核、分享与阅读记录；不会删除后端数据。请先导出需要的记录。</p><Button onClick={()=>{onReset();setReset(false)}}>确认重置本地会话</Button><Button variant="ghost" onClick={()=>setReset(false)}>取消</Button></div>:<Button variant="secondary" onClick={()=>setReset(true)}>重置本地会话</Button>}
    </section>
    <section className="form-card settings-delivery"><h2>推荐演示路线</h2><ol><li>导入原创示例，调整页序并检查文字。</li><li>确认图书类型；演示模式查看模拟阶段，真实模式检查后端任务状态。</li><li>完成内容复核，进入阅读页提问、点击、查看证据。</li><li>编辑笔记，主人审核后创建限时分享并撤销。</li><li>打开历史，按页码或时间跳转，导出记录。</li></ol><Button variant="secondary" onClick={()=>navigate('import')}>开始导入<Icon name="arrow" size={16}/></Button></section>
  </div>
}
