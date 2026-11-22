import { useState } from 'react'
import BackendWorkbench from '../components/BackendWorkbench'
import { Badge, Button, Icon } from '../components/ui'
import { SceneBackdrop } from '../components/PaperScene'
import type { Navigate } from '../app/types'

export default function SettingsPage({ navigate, onReset, appMode = 'demo', backendToken = '' }: {
  navigate: Navigate
  onReset: () => void
  appMode?: 'live' | 'demo'
  backendToken?: string
}) {
  const [reset, setReset] = useState(false)
  return (
    <div className="page-content settings-page">
      <SceneBackdrop tone="cool" />

      <div className="page-heading">
        <div>
          <p className="eyebrow">BEHIND YOUR READING SPACE</p>
          <h1>把每一个状态，讲清楚。</h1>
          <p className="page-description">本地演示、实际接口与模型能力，各有可检查的边界。</p>
        </div>
        <Badge tone={appMode === 'live' ? 'green' : 'amber'}>
          {appMode === 'live' ? '真实主流程 · 示例仍为模拟' : '本地演示模式'}
        </Badge>
      </div>

      {/* 后端联调面板：保持原有组件与逻辑，仅套用新的纸张容器 */}
      <section className="settings-panel paper-card paper-card--lg">
        <div className="settings-panel-head">
          <span className="settings-panel-icon"><Icon name="link" size={19} /></span>
          <div>
            <h2>后端联调</h2>
            <p>独立填写地址与令牌，手动发起请求；不会自动上传模拟数据。</p>
          </div>
          <Badge tone={backendToken ? 'green' : 'neutral'}>{backendToken ? '已填写令牌' : '未填写令牌'}</Badge>
        </div>
        <BackendWorkbench token={backendToken} />
      </section>

      <div className="settings-grid">
        <section className="settings-card paper-card">
          <div className="settings-card-head">
            <span className="settings-panel-icon settings-panel-icon--amber"><Icon name="lock" size={18} /></span>
            <h2>数据和演示会话</h2>
          </div>
          <p className="settings-copy">
            书架、导入草稿、书页原图与校对进度保存在此浏览器的本机草稿库，可在刷新或关闭后恢复；不会自动同步到其他设备。清除浏览器数据会删除这些本机草稿。演示模式的本地分享不提供真实权限控制。
          </p>
          <p className="settings-copy">
            真实模式中的新书主流程以及上方联调区域可请求后端；是否获得分析、视频、语音或分享结果取决于实际服务和权限。重置浏览器会话不会删除后端已创建的对象。演示内容不会自动变成真实结果。
          </p>
          {reset ? (
            <div className="reset-confirm">
              <p>重置会清除当前账号的本机书架、笔记审核、分享与阅读记录；不会删除导入草稿或后端数据。请先导出需要的记录。</p>
              <div className="wf-actions">
                <Button onClick={() => { onReset(); setReset(false) }}>确认重置本地会话</Button>
                <Button variant="ghost" onClick={() => setReset(false)}>取消</Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setReset(true)}>重置本地会话</Button>
          )}
        </section>

        <section className="settings-card paper-card paper-card--sage">
          <div className="settings-card-head">
            <span className="settings-panel-icon settings-panel-icon--sage"><Icon name="flag" size={18} /></span>
            <h2>推荐演示路线</h2>
          </div>
          <ol className="settings-route">
            <li><span>01</span>导入原创示例，调整页序并检查文字。</li>
            <li><span>02</span>确认图书类型；演示模式查看模拟阶段，真实模式检查后端任务状态。</li>
            <li><span>03</span>完成内容复核，进入阅读页提问、点击、查看证据。</li>
            <li><span>04</span>编辑笔记，主人审核后创建限时分享并撤销。</li>
            <li><span>05</span>打开历史，按页码或时间跳转，导出记录。</li>
          </ol>
          <Button variant="secondary" onClick={() => navigate('import')}>开始导入<Icon name="arrow" size={16} /></Button>
        </section>
      </div>

      <div className="home-footnote">
        <Icon name="info" size={15} />
        <span>本页只展示与调试接口状态，不代表官方评测结果；模型与视频能力以实际服务配置为准。</span>
      </div>
    </div>
  )
}
