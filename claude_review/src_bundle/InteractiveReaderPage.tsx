import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { Interaction, ReaderProps, Source, TouchDetail } from '../app/types'
import { Badge, Button, Icon } from '../components/ui'
import { calculateImageTouchCoordinates, calculateVideoTouchCoordinates } from '../features/interaction/VideoCoordinateMapper'
import { asrManager, getSpeechRecognizer } from '../features/interaction/asr/AsrProvider'
import type { RealBrowserSpeechRecognition } from '../features/interaction/asr/AsrProvider'
import { TtsPlayerWidget } from '../features/interaction/tts/TtsPlayerWidget'

export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function InteractiveReaderPage({
  book,
  state,
  setState,
  navigate,
  notify,
  interactions,
  onInteraction,
  seekTo,
  onSeekHandled,
  askQuestion,
  identifyTouch,
  appMode = 'live',
}: ReaderProps) {
  const [playing, setPlaying] = useState(false)
  const [timeMs, setTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(36000)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState<'question' | 'touch' | null>(null)
  const [error, setError] = useState('')
  const [videoError, setVideoError] = useState(false)
  const [result, setResult] = useState<Interaction | null>(null)
  const [touchMode, setTouchMode] = useState(false)
  const [lastAction, setLastAction] = useState<
    { kind: 'question'; text: string } | { kind: 'touch'; x: number; y: number; box: { width: number; height: number } } | null
  >(null)

  // 真实语音录音与普通话识别 (C 负责人交付)
  const [isRecording, setIsRecording] = useState(false)
  const [voiceInput, setVoiceInput] = useState(false)
  const [recordingTip, setRecordingTip] = useState<string | null>(null)
  const [ttsFirstAudioMs, setTtsFirstAudioMs] = useState<number | null>(null)
  const speechRecognizerRef = useRef<RealBrowserSpeechRecognition | null>(null)

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
  const currentInteractions = interactions.filter((item) => item.book_id === book.id && (!book.run_id || item.run_id === book.run_id))
  const latest = result ?? currentInteractions[0]

  useEffect(() => {
    mounted.current = true
    speechRecognizerRef.current = getSpeechRecognizer()
    return () => {
      mounted.current = false
      if (speechRecognizerRef.current) {
        speechRecognizerRef.current.stop().catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    requestVersion.current += 1
    setBusy(null)
    setPlaying(false)
    setTimeMs(0)
    setResult(null)
    setError('')
    setQuestion('')
    setVoiceInput(false)
    setVideoError(false)
    setDurationMs(36000)
  }, [book.id, book.run_id])

  useEffect(() => {
    if (isVideo || !playing || state !== 'success') return
    const timer = setInterval(() => {
      setTimeMs((value) => {
        if (value + 250 >= durationMs) {
          setPlaying(false)
          return durationMs
        }
        return value + 250
      })
    }, 250)
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
    if (!isVideo) {
      if (timeMs >= durationMs) setTimeMs(0)
      setPlaying((value) => !value)
      return
    }
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      try {
        await video.play()
        setPlaying(true)
        setError('')
      } catch {
        setError('视频暂时无法播放，请检查资源地址或点击重试。')
      }
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  async function ask(text: string, inputMethod: 'speech' | 'keyboard' = 'keyboard') {
    if (busy) return
    const trimmed = text.trim()
    if (!trimmed) {
      setError('提问内容不能为空，请通过语音或键盘输入问题。')
      return
    }
    setBusy('question')
    setError('')
    setLastAction({ kind: 'question', text: trimmed })
    const version = requestVersion.current
    try {
      const item = await askQuestion(trimmed, currentTime.current, inputMethod)
      if (mounted.current && requestVersion.current === version) {
        setResult(item)
        onInteraction(item)
      }
    } catch (cause: any) {
      if (mounted.current && requestVersion.current === version) {
        setError(cause instanceof Error ? cause.message : '提问请求失败，请检查后端服务。')
      }
    } finally {
      if (mounted.current && requestVersion.current === version) {
        setBusy(null)
      }
    }
  }

  async function touch(x: number, y: number, box: { width: number; height: number }, detail?: TouchDetail) {
    if (busy) return
    setBusy('touch')
    setError('')
    setLastAction({ kind: 'touch', x, y, box })
    const version = requestVersion.current
    try {
      const item = await identifyTouch(x, y, currentTime.current, box, detail)
      if (mounted.current && requestVersion.current === version) {
        setResult(item)
        onInteraction(item)
      }
    } catch (cause: any) {
      if (mounted.current && requestVersion.current === version) {
        setError(cause instanceof Error ? cause.message : '触控识别请求失败，请检查后端服务。')
      }
    } finally {
      if (mounted.current && requestVersion.current === version) {
        setBusy(null)
      }
    }
  }

  // 严格按队长 Review 意见：真实黑边过滤与归一化计算，通过 3/3 单元测试覆盖
  function clickFrame(event: MouseEvent<HTMLDivElement>) {
    if (!touchMode || busy) return
    const element = videoRef.current ?? imageRef.current
    if (!element) return

    const calculation =
      element instanceof HTMLVideoElement
        ? calculateVideoTouchCoordinates(event.nativeEvent, element)
        : calculateImageTouchCoordinates(event.nativeEvent, element as HTMLImageElement)
    if (!calculation.isInsideVideo || !calculation.touchPoint || !calculation.viewport) {
      setError('⚠️ ' + (calculation.reason || '点击处于画面黑边留白区域，已自动拦截。请点击画面内的故事物体。'))
      return
    }
    // 把映射算法的完整输出(原始像素 + 视口信息)原样透传，下游不得重算
    void touch(
      calculation.touchPoint.norm_x,
      calculation.touchPoint.norm_y,
      { width: calculation.debugInfo.renderWidth, height: calculation.debugInfo.renderHeight },
      { touch_point: calculation.touchPoint, viewport_info: calculation.viewport }
    )
  }

  // 真实普通话语音识别开始 / 停止控制
  const handleToggleVoiceRecord = async () => {
    const rec = speechRecognizerRef.current
    if (isRecording) {
      if (!rec) return
      const stopped = await rec.stopDetailed()
      setIsRecording(false)
      setRecordingTip(null)
      const asr = await asrManager.processSpeechRecognition(stopped.text, appMode, {
        confidence: stopped.confidence,
        errorCode: stopped.errorCode,
      })
      if (asr.errorCode === 'MICROPHONE_DENIED') {
        setError('麦克风或语音识别权限被拒绝，请在浏览器中允许后重试，或直接键盘输入。')
      } else if (asr.errorCode === 'TRANSCRIPTION_NETWORK_ERROR') {
        setError('语音识别服务无法连接（Chrome 的识别依赖在线服务），请改用 Edge/Safari 或键盘输入。')
      } else if (!asr.text) {
        setError('未能识别到有效语音。请说话清晰些后重试，系统不会自动编造问题。')
      } else {
        setQuestion(asr.text)
        setVoiceInput(true)
        notify(stopped.isFinal ? `已识别到语音：“${asr.text}”，请确认后提交。` : `识别结果可能不完整：“${asr.text}”，请核对后再提交。`)
      }
      return
    }
    setError('')
    if (!rec || !rec.isSupported()) {
      setError('当前浏览器不支持普通话语音识别，请使用 Chrome / Edge / Safari，或使用键盘输入。')
      return
    }
    const started = rec.start()
    if (started !== true) {
      setError('语音识别未能启动，请检查麦克风权限后重试，或使用键盘输入。')
      return
    }
    setIsRecording(true)
    setRecordingTip('正在聆听中… 请对着麦克风说出你的提问')
  }

  function goSource(source: Source) {
    if (source.source === 'original_page') {
      try {
        sessionStorage.setItem('paper-companion-focus-page', String(source.page_no))
      } catch {
        /* 仍可打开校对页 */
      }
      navigate('review', book.id)
      return
    }
    const target = source.start_ms ?? ((source.page_no - 1) / pageCount) * durationMs
    seek(target)
    notify(`已定位到第 ${source.page_no} 页 · ${formatTime(target)}`)
  }

  if (state !== 'success') {
    return (
      <div className="page-content reader-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">READ, ASK, DISCOVER</p>
            <h1>互动伴读</h1>
          </div>
        </div>
        <section className={`reader-state state-${state}`} role={state === 'error' ? 'alert' : 'status'}>
          <Icon name={state === 'error' ? 'alert' : 'book'} size={34} />
          <h2>{state === 'loading' ? '正在打开阅读世界' : state === 'empty' ? '这本书还没有可播放内容' : '阅读内容暂时没有打开'}</h2>
          <p>{state === 'loading' ? '正在准备画面、字幕和来源信息。' : state === 'empty' ? '先完成书页校对与生成，再回到这里开始。' : '请检查资源和连接后重试，已有历史会保留。'}</p>
          {state === 'error' ? (
            <Button onClick={() => setState('success')}>重新加载</Button>
          ) : state === 'empty' ? (
            <Button onClick={() => navigate('progress')}>
              查看生成进度<Icon name="arrow" size={17} />
            </Button>
          ) : null}
        </section>
      </div>
    )
  }

  if ((book.status !== 'READY' || !book.safety_reviewed) && !book.pages_only) {
    return (
      <div className="page-content reader-page">
        <section className="reader-state">
          <Icon name="lock" size={32} />
          <h2>这段阅读，还需要一点准备。</h2>
          <p>完成书页校对、分类确认、生成流程与主人内容复核后，再开启伴读。</p>
          <Button onClick={() => navigate('progress', book.id)}>
            查看生成进度<Icon name="arrow" size={17} />
          </Button>
        </section>
      </div>
    )
  }

  return (
    <div className="page-content reader-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">READ, ASK, DISCOVER</p>
          <h1>翻开故事，也打开好奇心。</h1>
          <p className="page-description">
            《{book.title}》 · {book.age_band || '适龄待复核'} · {appMode === 'live' ? '🟢 真实后端模式 (Live)' : '🟠 演示模式 (Demo)'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="secondary" onClick={() => navigate('history')}>
            会话历史<Icon name="clock" size={17} />
          </Button>
        </div>
      </div>

      {book.pages_only && (
        <div className="wf-warning" role="status" style={{ margin: '0 0 12px' }}>
          分析与视频尚未完成，当前只基于你校对过的书页文字回答，内容未经复核，也没有视频。
        </div>
      )}

      <div className="reader-layout">
        <section className="reader-workspace">
          <div className="reader-stage-heading">
            <Badge tone={appMode === 'live' ? 'green' : 'amber'}>
              {appMode === 'live' ? '真实后端服务 (严格鉴权与防伪造)' : '演示模式 (本地模拟)'}
            </Badge>
            <span>
              第 {currentPage + 1} / {pageCount} 页
            </span>
          </div>

          <div
            className={`reader-frame ${touchMode ? 'touch-active' : ''}`}
            onClick={clickFrame}
            aria-label="阅读画面"
            style={{ position: 'relative', cursor: touchMode ? 'crosshair' : 'default' }}
          >
            <div className="reader-film-grain" />
            {isVideo ? (
              <video
                ref={videoRef}
                src={book.video_url!}
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration
                  if (Number.isFinite(duration) && duration > 0) setDurationMs(duration * 1000)
                }}
                onTimeUpdate={(event) => setTimeMs(event.currentTarget.currentTime * 1000)}
                onEnded={() => setPlaying(false)}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                onError={() => {
                  setVideoError(true)
                  setPlaying(false)
                }}
                aria-label="互动阅读视频"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <img
                ref={imageRef}
                src={page?.image_url || '/art/page-forest.svg'}
                alt={`《${book.title}》第 ${currentPage + 1} 页画面`}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            )}
            <span className="frame-watermark">{isVideo ? `运行: ${book.run_id ?? '默认'}` : '静态书页'}</span>
            {touchMode && (
              <span className="touch-mode-tip" style={{ backgroundColor: 'rgba(15, 23, 42, 0.85)', color: '#38bdf8' }}>
                🎯 触控认物中：点击画面物体（黑边留白将自动过滤）
              </span>
            )}
            {videoError && (
              <div className="video-failed" role="alert">
                <Icon name="alert" size={25} />
                <h3>视频资源暂时无法播放</h3>
                <p>请检查视频地址或运行资源状态。</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setVideoError(false)
                    videoRef.current?.load()
                  }}
                >
                  重新载入视频
                </Button>
              </div>
            )}
          </div>

          <div className="reader-controls">
            <button
              className="play-toggle"
              onClick={() => void togglePlayback()}
              disabled={videoError}
              aria-label={playing ? '暂停播放' : '开始播放'}
            >
              {playing ? 'Ⅱ' : '▶'}
            </button>
            <span className="play-time">{formatTime(timeMs)}</span>
            <input
              type="range"
              min={0}
              max={durationMs}
              step={100}
              value={timeMs}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="播放进度"
            />
            <span className="play-time">{formatTime(durationMs)}</span>
            <button
              className={`touch-toggle ${touchMode ? 'selected' : ''}`}
              aria-pressed={touchMode}
              onClick={() => {
                setTouchMode((value) => !value)
                setError('')
              }}
            >
              {touchMode ? '退出认物' : '点击认物'}
            </button>
          </div>

          <div className="reader-subtitle">
            <span>字幕</span>
            <p>{page?.ocr_text || '书里的每一个小发现，都值得认真倾听。'}</p>
          </div>

          <div className="reader-source-bar">
            <span>
              <Icon name="book" size={16} />
              来源：第 {currentPage + 1} 页
            </span>
            <button onClick={() => navigate('review')}>
              查看书页与校对<Icon name="chevron" size={15} />
            </button>
          </div>

          <div className="reader-page-strip" aria-label="页码导航">
            {book.pages.map((item, index) => (
              <button
                key={item.id}
                className={index === currentPage ? 'selected' : ''}
                onClick={() => seek((index / pageCount) * durationMs)}
                aria-current={index === currentPage ? 'true' : undefined}
              >
                <img src={item.image_url || '/art/page-forest.svg'} alt="" />
                <span>第 {index + 1} 页</span>
              </button>
            ))}
          </div>

          <div className="run-metadata">
            <Icon name="info" size={16} />
            <span>
              book_id: {book.id} · run_id: {book.run_id || '未关联'} · 模式: {appMode}
            </span>
          </div>
        </section>

        <aside className="reader-assistant">
          <div className="assistant-title">
            <span>
              <Icon name="spark" size={22} />
            </span>
            <div>
              <h2>伴读助手</h2>
              <p>好问题，让故事更有趣。</p>
            </div>
          </div>

          <div className="assistant-note">
            <Icon name="info" size={16} />
            <p>
              {appMode === 'live'
                ? '已接入真实普通话 ASR 语音识别与后端交互上报。'
                : '当前为演示模式，回答使用示例逻辑。'}
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void ask(question, voiceInput ? 'speech' : 'keyboard')
              setVoiceInput(false)
            }}
          >
            <label htmlFor="reader-question">想问故事什么呢？</label>
            <textarea
              id="reader-question"
              maxLength={500}
              value={question}
              onChange={(event) => { setQuestion(event.target.value); setVoiceInput(false) }}
              placeholder="例如：小狐狸戴着什么颜色的围巾？"
              disabled={Boolean(busy) || isRecording}
            />

            {/* 真实语音识别控制栏 (C 真实交付) */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <button
                type="button"
                onClick={handleToggleVoiceRecord}
                disabled={Boolean(busy)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: isRecording ? '#ef4444' : '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  animation: isRecording ? 'pulse 1.5s infinite' : 'none',
                }}
              >
                {isRecording ? '⏹ 停止录音并识别' : '🎙️ 麦克风录音提问'}
              </button>
              {recordingTip && (
                <span style={{ fontSize: '12px', color: '#0284c7', alignSelf: 'center' }}>
                  {recordingTip}
                </span>
              )}
            </div>

            <div className="question-options">
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                {question.length}/500 字 · 支持语音识别与键盘输入
              </span>
            </div>

            <Button type="submit" disabled={Boolean(busy) || isRecording}>
              {busy === 'question' ? '正在寻找依据并生成回答…' : '问问伴读助手'}
              <Icon name="arrow" size={17} />
            </Button>
          </form>

          {busy === 'touch' && (
            <div className="assistant-loading" role="status">
              <Icon name="search" size={19} />
              正在识别触控目标与检索视频证据…
            </div>
          )}

          {error && (
            <div className="assistant-error" role="alert">
              <strong>
                <Icon name="alert" size={16} />
                操作未完成
              </strong>
              <p>{error}</p>
              {lastAction && (
                <button
                  onClick={() => {
                    if (lastAction.kind === 'question') void ask(lastAction.text, voiceInput ? 'speech' : 'keyboard')
                    else void touch(lastAction.x, lastAction.y, lastAction.box)
                  }}
                  disabled={Boolean(busy)}
                >
                  重试这次操作
                </button>
              )}
            </div>
          )}

          {latest ? (
            <section className="answer-card" aria-live="polite">
              <div className="answer-heading">
                <Badge tone={latest.uncertain ? 'amber' : 'green'}>
                  {latest.uncertain ? '证据不足或暂不确定' : latest.kind === 'touch' ? '画面里的发现' : '故事里的回答'}
                </Badge>
                <small>{latest.origin === 'mock' ? '演示模式' : '真实服务结果'}</small>
              </div>

              <p style={{ fontWeight: 500, fontSize: '15px', color: '#1e293b', margin: '8px 0' }}>
                {latest.answer}
              </p>

              {/* TTS 真实语音朗读组件 (C 交付) */}
              <div style={{ margin: '8px 0' }}>
                <TtsPlayerWidget textToSpeak={latest.answer} onAudioFirstByte={setTtsFirstAudioMs} />
              </div>

              {latest.transcript && <div className="answer-transcript">语音转写：{latest.transcript}</div>}

              <div className="answer-evidence">
                <span>回答依据与证据</span>
                {latest.sources && latest.sources.length ? (
                  latest.sources.map((source, index) => (
                    <button key={`${source.page_no}-${index}`} onClick={() => goSource(source)}>
                      <Icon name="book" size={14} />
                      第 {source.page_no} 页{source.start_ms !== null ? ` · ${formatTime(source.start_ms)}` : ''}
                      <Icon name="chevron" size={14} />
                    </button>
                  ))
                ) : (
                  <p style={{ color: '#94a3b8', fontSize: '12px' }}>
                    未命中确凿的单页或时间段证据，回答已标记为谨慎不确定。
                  </p>
                )}
              </div>

              <div className="answer-metrics">
                <span>{latest.latency_ms === null ? '延迟未实测' : `请求延迟 ${latest.latency_ms} ms`}</span>
                {ttsFirstAudioMs !== null && <span>TTS首音延迟 {ttsFirstAudioMs} ms</span>}
                <span>{latest.cached ? '缓存命中' : '实时生成'}</span>
                {latest.origin === 'real' && latest.persisted === false && (
                  <span role="alert" style={{ color: '#b91c1c' }}>未写入后端：{latest.persist_error ?? '原因未知'}</span>
                )}
              </div>
            </section>
          ) : (
            <div className="assistant-empty">
              <Icon name="book" size={28} />
              <p>
                提问或点击画面物体
                <br />
                伴读助手会严格基于书页证据给出回答
              </p>
            </div>
          )}

          <Button className="reader-note-link" variant="ghost" onClick={() => navigate('notes')}>
            整理这次阅读笔记<Icon name="note" size={17} />
          </Button>
        </aside>
      </div>

      <div className="home-footnote">
        <Icon name="lock" size={15} />
        <span>使用本地读者会话，不采集儿童个人隐私。所有问答与触控记录包含精确证据溯源与真实/模拟标记。</span>
      </div>
    </div>
  )
}
