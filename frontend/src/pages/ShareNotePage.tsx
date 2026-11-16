import { serverShareHash } from '../lib/sharedNoteView'
import { useEffect, useRef, useState } from 'react'
import type { ShareGrant, SharingProps } from '../app/types'
import { Badge, Button, Icon } from '../components/ui'

function dateText(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间无效' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }
function activeGrant(grant: ShareGrant, now: number) { return grant.status === 'active' && new Date(grant.expires_at).getTime() > now }
// 服务端分享：限时链接带服务端令牌；指定用户只带 note/share ID，访问者必须以本人令牌登录（E-029）
function linkFor(grant: ShareGrant) {
  const base = location.href.split('#')[0]
  if (grant.server && grant.server_note_id && grant.server_mode) return base + serverShareHash({ mode: grant.server_mode, token: grant.token, noteId: grant.server_note_id, shareId: grant.id })
  return `${base}#/shared?token=${encodeURIComponent(grant.token)}`
}

export default function ShareNotePage({ book, note, grants, state, setState, navigate, notify, onCreate, onRevoke, onOpen, appMode = 'live' }: SharingProps) {
  const [mode, setMode] = useState<ShareGrant['mode']>('expiring_link')
  const [recipients, setRecipients] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const linkRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const approved = !!note && note.review_status === 'approved' && note.reviewed_revision === note.revision
  const noteGrants = grants.filter(grant => grant.note_id === note?.id)
  const selected = noteGrants.find(grant => grant.id === selectedId) ?? noteGrants.find(grant => activeGrant(grant, now)) ?? noteGrants[0] ?? null
  async function create() {
    if (!approved) { setError('请先让主人审核当前笔记版本。'); return }
    const ids = [...new Set(recipients.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean))]
    if (mode === 'named_users' && !ids.length) { setError('请至少填写一个演示用户 ID。'); return }
    if (ids.some(id => !/^[a-zA-Z0-9_-]{1,40}$/.test(id))) { setError('演示用户 ID 只支持 1–40 位字母、数字、下划线或短横线。'); return }
    const grant = await onCreate({ mode, recipients: mode === 'named_users' ? ids : [], minutes })
    if (!grant) { setError('分享未创建，原因见页面提示。'); return }
    setSelectedId(grant.id); setError(''); notify(grant.server ? '已在服务端创建分享。' : '已创建本地模拟分享，可预览只读结果。')
  }
  async function copy() {
    if (!selected || !activeGrant(selected, now)) return
    try {
      await navigator.clipboard.writeText(linkFor(selected))
      notify(selected.server ? '只读分享链接已复制。凭此安全令牌可在有效期内公开只读访问。' : '模拟链接已复制，仅能在保存本地演示数据的浏览器中使用。')
    } catch {
      linkRef.current?.focus(); linkRef.current?.select()
      notify('当前浏览器不允许自动复制，已选中链接，请手动复制。')
    }
  }
  return <div className="page-content notes-page sharing-page"><div className="page-heading"><div><p className="eyebrow">GOOD DISCOVERIES ARE WORTH SHARING</p><h1>让发现，被合适的人看见。</h1><p className="page-description">分享阅读笔记《{note?.title ?? book.title}》，保留对内容的决定权。</p></div><Button variant="ghost" onClick={() => navigate('notes', book.id)}>返回笔记 <Icon name="arrow" size={16}/></Button></div>
    <div className="notes-origin"><Icon name="lock" size={17}/><span>{appMode === 'live' ? '真实分享模式（Live）：生成的只读凭证由服务端安全发放（POST /api/notes/{id}/shares）。凭证具备有效时限，可随时在服务端撤销，第三方只能在授权期内只读查看。' : '这是本地分享原型，未发布到公网。用户 ID、身份核验和链接权限均为模拟，真实访问控制须接后端。'}</span></div>
    {state === 'loading' ? <div className="notes-state" role="status"><span className="notes-state-icon"><Icon name="lock" size={28}/></span><h2>正在读取分享设置</h2><p>确认当前笔记版本和已有分享。</p></div> : state === 'error' ? <div className="notes-state" role="alert"><span className="notes-state-icon"><Icon name="alert" size={28}/></span><h2>分享设置暂时不可用</h2><p>模拟请求失败，笔记仍保持当前可见状态。</p><Button variant="secondary" onClick={() => setState('success')}>重新加载分享设置</Button></div> : state === 'empty' || !note ? <div className="notes-state"><span className="notes-state-icon"><Icon name="note" size={28}/></span><h2>还没有可分享的笔记</h2><p>先生成并审核一份笔记，再选择分享对象。</p><Button variant="secondary" onClick={() => navigate('notes', book.id)}>前往笔记</Button></div> : <div className="notes-layout"><section className="notes-editor-card"><div className="share-note-overview"><span className="note-icon"><Icon name="note" size={24}/></span><div><h2>{note.title}</h2><p>《{book.title}》· 版本 {note.revision} · {note.sources.length} 处引用</p></div><Badge tone={approved ? 'green' : 'amber'}>{approved ? '当前版本已审核' : '待主人审核'}</Badge></div>{!approved && <div className="notes-warning" role="status"><Icon name="alert" size={18}/><div><strong>当前笔记还不能分享</strong><p>需要主人审核通过当前版本。修改内容后，也需要重新审核。</p><button type="button" onClick={() => navigate('notes', book.id)}>前往主人审核 <Icon name="arrow" size={14}/></button></div></div>}
      <div className="share-section"><h2>谁可以看到这份笔记？</h2><div className="share-mode-options" role="group" aria-label="分享方式"><button type="button" className={mode === 'expiring_link' ? 'selected' : ''} aria-pressed={mode === 'expiring_link'} onClick={() => { setMode('expiring_link'); setError('') }}><span><Icon name="clock" size={23}/></span><strong>限时链接</strong><p>持有链接的人可在有效期内只读查看。</p>{mode === 'expiring_link' && <Icon name="check" size={18}/>}</button><button type="button" className={mode === 'named_users' ? 'selected' : ''} aria-pressed={mode === 'named_users'} onClick={() => { setMode('named_users'); setError('') }}><span><Icon name="lock" size={23}/></span><strong>指定用户</strong><p>仅填写的用户 ID 可通过模拟身份检查。</p>{mode === 'named_users' && <Icon name="check" size={18}/>}</button></div>{mode === 'named_users' && <label className="notes-field share-recipient-field">演示用户 ID<input aria-label="演示用户 ID" value={recipients} maxLength={300} placeholder="例如：reader_01, reader_02" onChange={event => setRecipients(event.target.value)}/><small>多个 ID 用逗号分隔；不要填写真实儿童姓名、电话或邮箱。</small></label>}<label className="notes-field share-duration">有效时间<select aria-label="分享有效时间" value={minutes} onChange={event => setMinutes(Number(event.target.value))}><option value={15}>15 分钟</option><option value={60}>1 小时</option><option value={1440}>24 小时</option></select><small>到期自动显示不可访问；你也可以提前撤销。</small></label></div>
      {error && <p className="notes-form-error" role="alert"><Icon name="alert" size={17}/>{error}</p>}<div className="share-create-footer"><span><Icon name="lock" size={15}/>只分享已审核版本的笔记快照</span><Button onClick={create} disabled={!approved}>{appMode === 'live' ? '创建安全分享' : '创建模拟分享'} <Icon name="arrow" size={17}/></Button></div>
      {selected && <section className="share-result" aria-labelledby="share-result-title"><div className="notes-section-heading"><h2 id="share-result-title">{activeGrant(selected, now) ? (selected.server ? '只读安全分享凭证已生效' : '模拟分享已创建') : selected.status === 'revoked' ? (selected.server ? '此分享已在服务端撤销' : '此分享已撤销') : '此分享已过期'}</h2><Badge tone={activeGrant(selected, now) ? 'green' : 'amber'}>{activeGrant(selected, now) ? '有效' : selected.status === 'revoked' ? '已撤销' : '已过期'}</Badge></div><p>版本 {selected.note_revision} · {selected.mode === 'named_users' ? '指定用户' : '限时链接'} · 截止 {dateText(selected.expires_at)}（北京时间）</p><label className="notes-field">{selected.server ? '服务端安全只读链接' : '本地模拟链接'}<input ref={linkRef} value={linkFor(selected)} readOnly aria-label={selected.server ? '服务端安全只读链接' : '本地模拟链接'} onFocus={event => event.target.select()}/></label><div className="share-result-actions"><Button variant="secondary" onClick={() => void copy()} disabled={!activeGrant(selected, now)}>复制链接</Button><Button variant="secondary" onClick={() => onOpen(selected)}>打开只读预览 <Icon name="arrow" size={16}/></Button></div><small>{selected.server ? (selected.server_mode === 'invite_only' ? '指定用户分享：链接里不含令牌，被邀请人必须用自己的令牌登录后访问，服务端核验身份；撤销或过期后服务端立即拒绝。' : '凭证已由后端发放，服务端只存令牌哈希。有效期内持有链接的人可只读查看；撤销或过期后服务端立即拒绝。') : '链接依赖当前浏览器的本地演示记录。复制到其他设备不会同步笔记，未产生公网访问能力。'}</small></section>}
    </section><aside className="notes-review-panel"><div className="notes-review-illustration"><span>✧</span><h2>分享，也能从容收回。</h2><p>不改变原稿，<br/>给每一次分享一个期限。</p></div><div className="notes-review-body"><div className="notes-section-heading"><h2>分享记录</h2><span>{noteGrants.length} 条</span></div>{noteGrants.length ? <ul className="share-records">{noteGrants.map(grant => <li key={grant.id}><div><strong>{grant.mode === 'named_users' ? '指定用户' : '限时链接'}</strong><Badge tone={activeGrant(grant, now) ? 'green' : 'amber'}>{activeGrant(grant, now) ? '有效' : grant.status === 'revoked' ? '已撤销' : '已过期'}</Badge></div><p>笔记版本 {grant.note_revision}</p>{grant.mode === 'named_users' && <p className="share-record-users">{grant.recipients.join('、')}</p>}<p>截止 {dateText(grant.expires_at)}</p><div className="share-record-actions"><button type="button" onClick={() => { setSelectedId(grant.id); onOpen(grant) }}>只读预览</button><button type="button" disabled={!activeGrant(grant, now)} onClick={() => { void onRevoke(grant.id) }}>撤销分享</button></div></li>)}</ul> : <div className="share-record-empty"><Icon name="lock" size={26}/><p>目前保持私密。<br/>创建后，分享记录会出现在这里。</p></div>}<p className="notes-lock-caption"><Icon name="info" size={15}/>修改笔记会使既有审核和分享失效；新版本需重新审核。</p></div></aside></div>}
  </div>
}

