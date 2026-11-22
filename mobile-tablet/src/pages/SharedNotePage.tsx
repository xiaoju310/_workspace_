import { useEffect, useState } from 'react'
import type { SharedProps } from '../app/types'
import { Badge, Button, Icon } from '../components/ui'

/** Live：只展示服务端核验后返回的内容；拒绝/失败时不显示任何笔记内容 */
function ServerSharedView({ view, navigate, onRetry }: { view: NonNullable<SharedProps['serverView']>; navigate: SharedProps['navigate']; onRetry?: () => void }) {
  const heading = <div className="page-heading"><div><p className="eyebrow">A DISCOVERY, SHARED WITH YOU</p><h1>一份来自阅读的礼物。</h1><p className="page-description">只读查看已审核的阅读笔记。</p></div><Button variant="ghost" onClick={() => navigate('home')}>返回阅读空间 <Icon name="arrow" size={16}/></Button></div>
  const origin = <div className="notes-origin"><Icon name="info" size={17}/><span>真实分享（Live）：访问权限、有效期和撤销状态由服务端核验，下方内容来自服务端，不是本地快照。</span></div>
  let body
  if (view.status === 'loading') body = <div className="notes-state" role="status" data-shared-status="loading"><span className="notes-state-icon"><Icon name="note" size={28}/></span><h2>正在向服务端核验分享</h2><p>核对令牌、有效期、撤销状态和查看身份。</p></div>
  else if (view.status === 'missing') body = <div className="notes-state shared-denied" role="status" data-shared-status="missing"><span className="notes-state-icon"><Icon name="lock" size={28}/></span><h2>链接不完整</h2><p>缺少分享令牌或邀请编号。</p><Badge tone="amber">内容未展示</Badge></div>
  else if (view.status === 'denied') body = <div className="notes-state shared-denied" role="status" data-shared-status="denied" data-shared-code={view.code}><span className="notes-state-icon"><Icon name="lock" size={28}/></span><h2>{view.title}</h2><p>{view.detail}</p><Badge tone="amber">内容未展示</Badge>{onRetry && <Button variant="secondary" onClick={onRetry}>重新核验</Button>}</div>
  else body = <article className="shared-reading-card" data-shared-status="ok"><header><div className="notes-badges"><Badge tone="green">服务端已核验</Badge><Badge>只读</Badge><span className="notes-revision">服务端版本 {view.note.version}</span></div><h2>{view.note.title}</h2></header><section className="shared-summary"><h3>阅读发现</h3><p>{view.note.summary || '（摘要为空）'}</p><div className="notes-concept-list">{view.note.concepts.map((concept, index) => <Badge key={`${concept}-${index}`}>{concept}</Badge>)}</div></section><section className="notes-sources"><div className="notes-section-heading"><h2>来源引用</h2><span>{view.note.sources.length} 处</span></div>{view.note.sources.length ? view.note.sources.map((source, index) => <blockquote className="shared-source" key={`${source.page_no}-${index}`}>{source.quote || '未提供引用文字。'}<cite>第 {source.page_no} 页{source.start_ms !== null ? ` · ${(source.start_ms / 1000).toFixed(1)} 秒` : ''}</cite></blockquote>) : <p className="notes-inline-help">来源待补充。</p>}</section><footer><Icon name="lock" size={16}/><span>只读视图：原图、音频和编辑操作不会随本页提供。</span></footer></article>
  return <div className="page-content notes-page shared-note-page">{heading}{origin}{body}</div>
}

export default function SharedNotePage({ state, grant, recipient, setRecipient, navigate, serverView, onRetryServer }: SharedProps) {
  if (serverView) return <ServerSharedView view={serverView} navigate={navigate} onRetry={onRetryServer} />
  return <LocalSharedNotePage state={state} grant={grant} recipient={recipient} setRecipient={setRecipient} navigate={navigate} />
}

function LocalSharedNotePage({ state, grant, recipient, setRecipient, navigate }: SharedProps) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const expiresAt = grant ? new Date(grant.expires_at).getTime() : 0
  const revoked = grant?.status === 'revoked'
  const expired = !Number.isFinite(expiresAt) || expiresAt <= now
  const validSnapshot = !!grant && grant.snapshot.review_status === 'approved' && grant.snapshot.reviewed_revision === grant.note_revision && grant.snapshot.revision === grant.note_revision
  const permitted = grant?.mode !== 'named_users' || grant.recipients.includes(recipient.trim())
  const accessible = !!grant && !revoked && !expired && permitted && validSnapshot && state === 'success'
  const reason = !grant || state === 'empty' ? ['没有找到这份分享', '链接可能不完整，或当前浏览器没有对应的本地演示记录。'] : revoked ? ['这份分享已经撤销', '主人已收回查看权限，分享内容不再显示。'] : expired ? ['这份分享已经过期', '请联系主人重新创建分享；本次不再显示笔记内容。'] : !validSnapshot ? ['这份笔记尚不可查看', '分享版本未通过有效审核，请由主人重新审核并创建分享。'] : ['当前演示身份无法查看', '请填写主人设置的演示用户 ID。真实身份核验将在后端接入后完成。']
  return <div className="page-content notes-page shared-note-page"><div className="page-heading"><div><p className="eyebrow">A DISCOVERY, SHARED WITH YOU</p><h1>一份来自阅读的礼物。</h1><p className="page-description">只读查看已审核的阅读笔记。</p></div><Button variant="ghost" onClick={() => navigate('home')}>返回阅读空间 <Icon name="arrow" size={16}/></Button></div><div className="notes-origin"><Icon name="info" size={17}/><span>本地只读分享预览。身份、链接和权限判断为模拟展示，不提供真实访问控制。</span></div>
    {grant?.mode === 'named_users' && !revoked && !expired && state === 'success' && <section className="shared-identity"><span className="notes-state-icon"><Icon name="lock" size={22}/></span><label className="notes-field">当前演示身份 ID<input aria-label="当前演示身份 ID" value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="输入主人指定的演示用户 ID" maxLength={40} autoComplete="off"/><small>此输入仅用于演示允许 / 越权两种结果，不是登录认证。</small></label></section>}
    {state === 'loading' ? <div className="notes-state" role="status"><span className="notes-state-icon"><Icon name="note" size={28}/></span><h2>正在检查分享状态</h2><p>核对有效期、版本和查看范围。</p></div> : state === 'error' ? <div className="notes-state" role="alert"><span className="notes-state-icon"><Icon name="alert" size={28}/></span><h2>分享暂时无法打开</h2><p>模拟读取失败。请返回阅读空间后重试。</p><Button variant="secondary" onClick={() => navigate('home')}>返回阅读空间</Button></div> : !accessible ? <div className="notes-state shared-denied" role="status"><span className="notes-state-icon"><Icon name="lock" size={28}/></span><h2>{reason[0]}</h2><p>{reason[1]}</p><Badge tone="amber">内容未展示</Badge></div> : <article className="shared-reading-card"><header><div className="notes-badges"><Badge tone="green">主人已审核</Badge><Badge>只读</Badge><span className="notes-revision">版本 {grant.note_revision}</span></div><h2>{grant.snapshot.title}</h2><p>有效至 {new Date(grant.expires_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）</p></header><section className="shared-summary"><h3>阅读发现</h3><p>{grant.snapshot.summary}</p><div className="notes-concept-list">{grant.snapshot.concepts.map((concept, index) => <Badge key={`${concept}-${index}`}>{concept}</Badge>)}</div></section><section className="notes-sources"><div className="notes-section-heading"><h2>来源引用</h2><span>{grant.snapshot.sources.length} 处</span></div>{grant.snapshot.sources.length ? grant.snapshot.sources.map((source, index) => <blockquote className="shared-source" key={`${source.page_no}-${index}`}>{source.quote || '未提供引用文字。'}<cite>第 {source.page_no} 页{source.start_ms !== null ? ` · ${(source.start_ms / 1000).toFixed(1)} 秒` : ''} · {source.source === 'original_page' ? '原书书页' : source.source === 'script' ? '故事脚本' : '视频画面'}</cite></blockquote>) : <p className="notes-inline-help">来源待补充。</p>}</section><footer><Icon name="lock" size={16}/><span>这是已审核笔记的只读快照。原图、音频和编辑操作不会随本页提供。</span></footer></article>}
  </div>
}

