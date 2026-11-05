import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { Interaction, ReaderProps, Source } from '../app/types'
import { Badge, Button, Icon } from '../components/ui'

export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function InteractiveReaderPage({ book, state, setState, navigate, notify, interactions, onInteraction, seekTo, onSeekHandled, askQuestion, identifyTouch }: ReaderProps) {
  const [playing, setPlaying] = useState(false)
  const [timeMs, setTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(36000)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState<'question' | 'touch' | null>(null)
  const [error, setError] = useState('')
  const [videoError, setVideoError] = useState(false)
  const [result, setResult] = useState<Interaction | null>(null)
  const [touchMode, setTouchMode] = useState(false)
  const [lastAction, setLastAction] = useState<{ kind: 'question'; text: string } | { kind: 'touch'; x: number; y: number; box: { width: number; height: number } } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const mounted = useRef(true)
  const requestVersion = useRef(0)
  const currentTime = useRef(0)
  currentTime.current = timeMs
  const pageCount = Math.max(1, book.pages.length)
  const currentPage = Math.min(pageCount - 1, Math.floor(timeMs / Math.max(1, durationMs / pageCount)))
  const page = book.pages[currentPage]
  const isVideo = Boolean(book.video_url)
  const currentInteractions = interactions.filter(item => item.book_id === book.id && (!book.run_id || item.run_id === book.run_id))
  const latest = result ?? currentInteractions[0]

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { requestVersion.current += 1; setBusy(null); setPlaying(false); setTimeMs(0); setResult(null); setError(''); setQuestion(''); setVideoError(false); setDurationMs(36000) }, [book.id, book.run_id])
  useEffect(() => {
    if (isVideo || !playing || state !== 'success') return
    const timer = setInterval(() => setTimeMs(value => {
      if (value + 250 >= durationMs) { setPlaying(false); return durationMs }
      return value + 250
    }), 250)
    return () => clearInterval(timer)
  }, [playing, isVideo, durationMs, state])
  useEffect(() => {
    if (seekTo === null) return
    const next = Math.max(0, Math.min(durationMs, seekTo))
    setTimeMs(next)
    if (videoRef.current) videoRef.current.currentTime = next / 1000
    onSeekHandled()
  }, [seekTo, durationMs, onSeekHandled])

  function seek(value: number) {
    const next = Math.max(0, Math.min(durationMs, value))
    setTimeMs(next)
    if (videoRef.current) videoRef.current.currentTime = next / 1000
  }

  async function togglePlayback() {
    if (!isVideo) { if (timeMs >= durationMs) setTimeMs(0); setPlaying(value => !value); return }
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      try { await video.play(); setPlaying(true); setError('') }
      catch { setError('视频暂时无法播放，请检查资源地址或点击重试。') }
    } else { video.pause(); setPlaying(false) }
  }

  async function ask(text: string) {
    if (busy) return
    const trimmed = text.trim()
    if (!trimmed) { setError('先写下一个问题，再交给伴读助手。'); return }
    setBusy('question'); setError(''); setLastAction({ kind: 'question', text: trimmed })
    const version = requestVersion.current
    try { const item = await askQuestion(trimmed, currentTime.current); if (mounted.current && requestVersion.current === version) { setResult(item); onInteraction(item) } }
    catch (cause) { if (mounted.current && requestVersion.current === version) setError(cause instanceof Error ? cause.message : '提问暂时失败，请重试。') }
    finally { if (mounted.current && requestVersion.current === version) setBusy(null) }
  }

  async function touch(x: number, y: number, box: { width: number; height: number }) {
    if (busy) return
    setBusy('touch'); setError(''); setLastAction({ kind: 'touch', x, y, box })
    const version = requestVersion.current
    try { const item = await identifyTouch(x, y, currentTime.current, box); if (mounted.current && requestVersion.current === version) { setResult(item); onInteraction(item) } }
    catch (cause) { if (mounted.current && requestVersion.current === version) setError(cause instanceof Error ? cause.message : '点击识别暂时失败，请重试。') }
    finally { if (mounted.current && requestVersion.current === version) setBusy(null) }
  }

  function clickFrame(event: MouseEvent<HTMLDivElement>) {
    if (!touchMode || busy) return
    const element = videoRef.current ?? imageRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
    const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
    if (!naturalWidth || !naturalHeight) { setError('画面尚未加载，请稍后再点。'); return }
    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
    const width = naturalWidth * scale, height = naturalHeight * scale
    const left = rect.left + (rect.width - width) / 2, top = rect.top + (rect.height - height) / 2
    const x = (event.clientX - left) / width, y = (event.clientY - top) / height
    if (x < 0 || y < 0 || x > 1 || y > 1) { setError('这里是画面留白，请点击书页或视频里的物体。'); return }
    void touch(x, y, { width, height })
  }

  function goSource(source: Source) {
    if(source.source==='original_page') {try{sessionStorage.setItem('paper-companion-focus-page',String(source.page_no))}catch{/* 仍可打开校对页 */}navigate('review',book.id);return}
    const target = source.start_ms ?? ((source.page_no - 1) / pageCount) * durationMs
    seek(target)
    notify(`已定位到第 ${source.page_no} 页 · ${formatTime(target)}`)
  }

  if (state !== 'success') return <div className="page-content reader-page"><div className="page-heading"><div><p className="eyebrow">READ, ASK, DISCOVER</p><h1>互动伴读</h1></div></div><section className={`reader-state state-${state}`} role={state === 'error' ? 'alert' : 'status'}><Icon name={state === 'error' ? 'alert' : 'book'} size={34}/><h2>{state === 'loading' ? '正在打开阅读世界' : state === 'empty' ? '这本书还没有可播放内容' : '阅读内容暂时没有打开'}</h2><p>{state === 'loading' ? '正在准备画面、字幕和来源信息。' : state === 'empty' ? '先完成书页校对与生成，再回到这里开始。' : '请检查资源和连接后重试，已有历史会保留。'}</p>{state === 'error' ? <Button onClick={() => setState('success')}>重新加载</Button> : state === 'empty' ? <Button onClick={() => navigate('progress')}>查看生成进度<Icon name="arrow" size={17}/></Button> : null}</section></div>

  if(book.status!=='READY'||!book.safety_reviewed)return <div className="page-content reader-page"><section className="reader-state"><Icon name="lock" size={32}/><h2>这段阅读，还需要一点准备。</h2><p>完成书页校对、分类确认、生成流程与主人内容复核后，再开启伴读。</p><Button onClick={()=>navigate('progress',book.id)}>查看生成进度<Icon name="arrow" size={17}/></Button></section></div>
  return <div className="page-content reader-page"><div className="page-heading"><div><p className="eyebrow">READ, ASK, DISCOVER</p><h1>翻开故事，也打开好奇心。</h1><p className="page-description">《{book.title}》 · {book.age_band || '适龄待复核'} · {book.origin === 'mock' ? '模拟阅读' : '真实运行'}</p></div><Button variant="secondary" onClick={() => navigate('history')}>会话历史<Icon name="clock" size={17}/></Button></div>
    <div className="reader-layout"><section className="reader-workspace"><div className="reader-stage-heading"><Badge tone={book.origin === 'mock' ? 'amber' : 'green'}>{book.origin === 'mock' ? '模拟画面 · 非模型生成视频' : '服务端视频资源'}</Badge><span>第 {currentPage + 1} / {pageCount} 页</span></div><div className={`reader-frame ${touchMode ? 'touch-active' : ''}`} onClick={clickFrame} aria-label="阅读画面"><div className="reader-film-grain"/>{isVideo ? <video ref={videoRef} src={book.video_url!} playsInline preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) setDurationMs(duration * 1000) }} onTimeUpdate={event => setTimeMs(event.currentTarget.currentTime * 1000)} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onError={() => { setVideoError(true); setPlaying(false) }} aria-label="互动阅读视频"/> : <img ref={imageRef} src={page?.image_url || '/art/page-forest.svg'} alt={`《${book.title}》第 ${currentPage + 1} 页原创模拟画面`}/>}<span className="frame-watermark">{isVideo ? '当前运行' : '原创示例 · 静态模拟'}</span>{touchMode && <span className="touch-mode-tip">点击画面中的物体 · 留白不参与识别</span>}{videoError && <div className="video-failed" role="alert"><Icon name="alert" size={25}/><h3>视频资源暂时无法播放</h3><p>请检查视频地址、格式或资源访问权限。</p><Button variant="secondary" onClick={() => { setVideoError(false); videoRef.current?.load() }}>重新载入视频</Button></div>}</div>
      <div className="reader-controls"><button className="play-toggle" onClick={() => void togglePlayback()} disabled={videoError} aria-label={playing ? '暂停播放' : '开始播放'}>{playing ? 'Ⅱ' : '▶'}</button><span className="play-time">{formatTime(timeMs)}</span><input type="range" min={0} max={durationMs} step={100} value={timeMs} onChange={event => seek(Number(event.target.value))} aria-label="播放进度"/><span className="play-time">{formatTime(durationMs)}</span><button className={`touch-toggle ${touchMode ? 'selected' : ''}`} aria-pressed={touchMode} onClick={() => { setTouchMode(value => !value); setError('') }}>点击认物</button></div><div className="reader-subtitle"><span>字幕</span><p>{page?.ocr_text || '书里的每一个小发现，都值得认真倾听。'}</p></div><div className="reader-source-bar"><span><Icon name="book" size={16}/>来源：第 {currentPage + 1} 页</span><button onClick={() => navigate('review')}>查看书页与校对<Icon name="chevron" size={15}/></button></div>
      <div className="reader-page-strip" aria-label="页码导航">{book.pages.map((item, index) => <button key={item.id} className={index === currentPage ? 'selected' : ''} onClick={() => seek((index / pageCount) * durationMs)} aria-current={index === currentPage ? 'true' : undefined}><img src={item.image_url || '/art/page-forest.svg'} alt=""/><span>第 {index + 1} 页</span></button>)}</div><div className="run-metadata"><Icon name="info" size={16}/><span>run_id：{book.run_id || '未创建运行'} · {book.safety_reviewed ? '已复核' : '内容待主人复核'}{book.origin === 'mock' ? ' · 静态演示不计为真实视频生成结果' : ''}</span></div>
    </section><aside className="reader-assistant"><div className="assistant-title"><span><Icon name="spark" size={22}/></span><div><h2>你的伴读助手</h2><p>好问题，让故事更有趣。</p></div></div><div className="assistant-note"><Icon name="info" size={16}/><p>{book.origin === 'mock' ? '当前使用模拟回答。真实录音、转写与语音播放由 C 的互动接口接入后提供。' : '当前回答来自配置的服务端；真实录音与语音播放仍需 C 的交互模块。'}</p></div><form onSubmit={event => { event.preventDefault(); void ask(question) }}><label htmlFor="reader-question">想问故事什么呢？</label><textarea id="reader-question" maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="例如：小狐狸为什么要寄出这封信？" disabled={Boolean(busy)}/><div className="question-options"><button type="button" onClick={() => { setQuestion('小狐狸为什么要寄出这封信？'); notify('已填入模拟转写，你可以修改后提交。') }} disabled={Boolean(busy)}>试用语音转写示例</button><span>{question.length}/500</span></div><Button type="submit" disabled={Boolean(busy)}>{busy === 'question' ? '正在寻找答案…' : '问问伴读助手'}<Icon name="arrow" size={17}/></Button></form><div className="suggested-question"><span>也可以这样问</span>{['这页发生了什么？', '小狐狸的朋友是谁？'].map(text => <button key={text} onClick={() => { setQuestion(text); void ask(text) }} disabled={Boolean(busy)}>{text}<Icon name="chevron" size={14}/></button>)}</div>
      {busy === 'touch' && <div className="assistant-loading" role="status"><Icon name="search" size={19}/>正在看看你点中了什么…</div>}{error && <div className="assistant-error" role="alert"><strong><Icon name="alert" size={16}/>操作未完成</strong><p>{error}</p>{lastAction && <button onClick={() => { if (lastAction.kind === 'question') void ask(lastAction.text); else void touch(lastAction.x, lastAction.y, lastAction.box) }} disabled={Boolean(busy)}>重试这次操作</button>}</div>}
      {latest ? <section className="answer-card" aria-live="polite"><div className="answer-heading"><Badge tone={latest.uncertain ? 'amber' : 'green'}>{latest.uncertain ? '暂时无法确定' : latest.kind === 'touch' ? '画面里的发现' : '故事里的答案'}</Badge><small>{latest.origin === 'mock' ? '模拟回答' : '接口返回'}</small></div><p>{latest.answer}</p>{latest.transcript && <div className="answer-transcript">转写：{latest.transcript}</div>}<div className="answer-evidence"><span>看看回答从哪里来</span>{latest.sources.length ? latest.sources.map((source, index) => <button key={`${source.page_no}-${index}`} onClick={() => goSource(source)}><Icon name="book" size={14}/>第 {source.page_no} 页{source.start_ms !== null ? ` · ${formatTime(source.start_ms)}` : ''}<Icon name="chevron" size={14}/></button>) : <p>来源不足，请调整问题或等待补充。</p>}</div><div className="answer-metrics"><span>{latest.latency_ms === null ? '延迟未实测' : `接口延迟 ${latest.latency_ms} ms`}</span><span>{latest.cached ? '缓存命中' : '本次请求'}</span></div></section> : <div className="assistant-empty"><Icon name="book" size={28}/><p>把第一个问题留给故事。<br/>有依据，才有放心的回答。</p></div>}<Button className="reader-note-link" variant="ghost" onClick={() => navigate('notes')}>整理这次阅读笔记<Icon name="note" size={17}/></Button>
    </aside></div><div className="home-footnote"><Icon name="lock" size={15}/><span>使用模拟读者，不采集儿童信息。问答与点击记录保留来源、运行标识及模拟/真实标记。</span></div>
  </div>
}
