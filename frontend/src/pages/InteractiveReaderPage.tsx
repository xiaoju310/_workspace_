import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { Interaction, ReaderProps, Source, TouchDetail, VoiceCapture } from '../app/types'
import { Badge, Button, Icon } from '../components/ui'
import { calculateImageTouchCoordinates, calculateVideoTouchCoordinates } from '../features/interaction/VideoCoordinateMapper'
import { AudioRecorder } from '../features/interaction/AudioRecorder'
import type { RecordingMeta } from '../features/interaction/AudioRecorder'
import { TtsPlayerWidget } from '../features/interaction/tts/TtsPlayerWidget'
import { captureFrame } from '../features/interaction/frameCapture'
import { pageBasisLabel, pageNoOf, pageStartMs, resolvePageAtTime } from '../features/interaction/pageTimeline'
import type { PageBasis } from '../features/interaction/pageTimeline'

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
  videoState,
  onReloadVideo,
  segments,
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
  // 重试必须重放"完全相同"的请求：旧实现重试触控时丢掉了 touch_point/viewport_info（Live 直接报错），
  // 重试提问时 inputMethod 已被提交时重置，语音提问会被记成键盘输入
  const [lastAction, setLastAction] = useState<
    | { kind: 'question'; text: string; inputMethod: 'speech' | 'keyboard'; voice?: VoiceCapture }
    | { kind: 'touch'; x: number; y: number; box: { width: number; height: number }; detail?: TouchDetail; videoMs: number }
    | null
  >(null)
  const [metadataReady, setMetadataReady] = useState(false)
  // 视频元数据未就绪前到达的跳转（例如从历史记录回到 50 秒）：先挂起，拿到真实时长后再执行
  const pendingSeek = useRef<number | null>(null)

  // 真实录音提问（D1）：AudioRecorder 同时录制 16kHz WAV 并调用浏览器普通话识别。
  // 旧实现阅读页只调用识别器、从不录音，AudioRecorder 组件写好了却没有任何页面引用。
  const [isRecording, setIsRecording] = useState(false)
  const [voiceInput, setVoiceInput] = useState(false)
  const [ttsFirstAudioMs, setTtsFirstAudioMs] = useState<number | null>(null)
  /** 最近一次录音；随下一次提问一起提交（即使识别失败、用户改为打字，原始音频也作为失败样本留痕） */
  const pendingVoice = useRef<VoiceCapture | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const mounted = useRef(true)
  const requestVersion = useRef(0)
  const currentTime = useRef(0)
  currentTime.current = timeMs
  // 点击后截图是异步的：busy 状态要等下一次渲染才生效，这期间的第二次点击会再发一次请求。用 ref 同步占位
  const touchPending = useRef(false)

  const pageCount = Math.max(1, book.pages.length)
  const isVideo = Boolean(book.video_url)
  // 视频：页码以后端登记的时间轴(segments)为准，B 生成的每页视频未必等长；没有时间轴只能估算，且不当作证据。
  // 静态书页没有视频时间轴，按阅读页自带的模拟进度条平均切页（画面本身就是该页）。
  const pageAt = isVideo ? resolvePageAtTime(timeMs, book.pages, segments, durationMs) : null
  const currentPage = pageAt
    ? pageAt.index
    : Math.min(pageCount - 1, Math.floor(timeMs / Math.max(1, durationMs / pageCount)))
  const pageBasis: PageBasis = pageAt ? pageAt.basis : 'page_image'
  const page = book.pages[currentPage]
  const currentInteractions = interactions.filter((item) => item.book_id === book.id && (!book.run_id || item.run_id === book.run_id))
  const latest = result ?? currentInteractions[0]


  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    requestVersion.current += 1
    pendingVoice.current = null
    setBusy(null)
    setPlaying(false)
    setTimeMs(0)
    setResult(null)
    setTtsFirstAudioMs(null)
    setError('')
    setQuestion('')
    setVoiceInput(false)
    setVideoError(false)
    setDurationMs(36000)
    setMetadataReady(false)
    pendingSeek.current = null
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
    // 旧实现：视频元数据到达前 durationMs 还是 36 秒占位值，历史里 50 秒的证据会被夹到 36 秒
    if (isVideo && !metadataReady) {
      pendingSeek.current = Math.max(0, seekTo)
      setTimeMs(Math.max(0, seekTo))
      onSeekHandled()
      return
    }
    const next = Math.max(0, Math.min(durationMs, seekTo))
    setTimeMs(next)
    if (videoRef.current) videoRef.current.currentTime = next / 1000
    onSeekHandled()
  }, [seekTo, durationMs, onSeekHandled, isVideo, metadataReady])

  function seek(value: number) {
    if (isVideo && !metadataReady) {
      // 时长未知时不能按 36 秒占位值截断；等元数据到达后再执行
      pendingSeek.current = Math.max(0, value)
      setTimeMs(Math.max(0, value))
      return
    }
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

  async function ask(text: string, inputMethod: 'speech' | 'keyboard' = 'keyboard', voice?: VoiceCapture) {
    if (busy) return
    const trimmed = text.trim()
    if (!trimmed) {
      setError('提问内容不能为空，请通过语音或键盘输入问题。')
      return
    }
    setBusy('question')
    setError('')
    setTtsFirstAudioMs(null)
    setLastAction({ kind: 'question', text: trimmed, inputMethod, voice })
    const version = requestVersion.current
    try {
      const item = await askQuestion(trimmed, currentTime.current, inputMethod, voice)
      if (mounted.current && requestVersion.current === version) {
        setResult(item)
        setTtsFirstAudioMs(null)
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

  async function touch(x: number, y: number, box: { width: number; height: number }, detail?: TouchDetail, videoMs = currentTime.current) {
    if (busy) return
    setBusy('touch')
    setError('')
    setTtsFirstAudioMs(null)
    // 重试是同一次点击：保留原视频时间与截图，但去掉点击时刻（否则重试的延迟会算上用户看错误提示的时间）
    const retryDetail = detail?.frame ? { ...detail, frame: { ...detail.frame, clicked_at: undefined, capture_ms: undefined } } : detail
    setLastAction({ kind: 'touch', x, y, box, detail: retryDetail, videoMs })
    const version = requestVersion.current
    try {
      const item = await identifyTouch(x, y, videoMs, box, detail)
      if (mounted.current && requestVersion.current === version) {
        setResult(item)
        setTtsFirstAudioMs(null)
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
    if (!touchMode || busy || touchPending.current) return
    const element = videoRef.current ?? imageRef.current
    if (!element) return
    if (!isVideo && !page?.image_url) {
      // 没有真实书页图片时显示的是占位插画：点它得到的坐标与这本书无关，不能上报
      setError('⚠️ 当前页没有书页图片（显示的是占位插画），无法进行触控认物。')
      return
    }

    const calculation =
      element instanceof HTMLVideoElement
        ? calculateVideoTouchCoordinates(event.nativeEvent, element)
        : calculateImageTouchCoordinates(event.nativeEvent, element as HTMLImageElement)
    if (!calculation.isInsideVideo || !calculation.touchPoint || !calculation.viewport) {
      setError('⚠️ ' + (calculation.reason || '点击处于画面黑边留白区域，已自动拦截。请点击画面内的故事物体。'))
      return
    }
    // 把映射算法的完整输出(原始像素 + 视口信息)原样透传，下游不得重算
    const touchPoint = calculation.touchPoint
    const viewport = calculation.viewport
    const box = { width: calculation.debugInfo.renderWidth, height: calculation.debugInfo.renderHeight }
    const frameKind = element instanceof HTMLVideoElement ? 'video' as const : 'page_image' as const
    // 点击时刻的视频时间与页码：截图是异步的，等截图完成再读会偏后（视频在播放）
    const clickedAt = performance.now()
    // 视频：先暂停锁住画面，再直接读元素的 currentTime。
    // 不能用 timeMs 状态：它来自 timeupdate 事件（约 250ms 一次），播放中会比真实画面落后最多约 250ms（队长 PR 审查第 1 条）
    let clickVideoMs = currentTime.current
    let pausedOnClick = false
    if (element instanceof HTMLVideoElement) {
      if (!element.paused) {
        element.pause()
        pausedOnClick = true
      }
      clickVideoMs = Math.round(element.currentTime * 1000)
      setTimeMs(clickVideoMs)
    }
    // 页码用点击那一刻的视频时间换算（clickVideoMs），不能用渲染状态里的 currentPage：它来自约 250ms 一次的 timeupdate，且在没有时间轴时只是估算。
    // 只有后端时间轴命中（或静态书页）才记确定页码；否则记 null 并写明依据，不声称知道点的是哪一页。
    const clicked = element instanceof HTMLVideoElement ? resolvePageAtTime(clickVideoMs, book.pages, segments, durationMs) : null
    const clickedBasis: PageBasis = clicked ? clicked.basis : 'page_image'
    const pageNo = clicked ? (clicked.exact ? clicked.pageNo : null) : pageNoOf(book.pages[currentPage] ?? {}, currentPage)
    touchPending.current = true
    // D8：点击瞬间截取当前画面（视频帧或书页图）；截图失败不阻断触控，只如实记录原因
    // D9：clicked_at 交给下游作为延迟起点，latency_ms = 点击 → 拿到识别结果（含截图耗时）
    void captureFrame(element)
      .then((shot) =>
        touch(
          touchPoint.norm_x,
          touchPoint.norm_y,
          box,
          {
            touch_point: touchPoint,
            viewport_info: viewport,
            frame: {
              kind: frameKind,
              page_no: pageNo,
              page_basis: clickedBasis,
              snapshot: shot.ok ? shot.snapshot : null,
              snapshot_error: shot.ok ? undefined : shot.reason,
              clicked_at: clickedAt,
              capture_ms: Math.round(performance.now() - clickedAt),
              frame_time_ms: shot.ok ? shot.snapshot.frameTimeMs : null,
              paused_on_click: pausedOnClick,
            },
          },
          clickVideoMs
        )
      )
      .finally(() => {
        touchPending.current = false
      })
  }


  function handleRecording(blob: Blob, mimeType: string, transcript: string, meta: RecordingMeta) {
    const text = transcript.trim()
    pendingVoice.current = { blob, mimeType, durationMs: meta.durationMs, transcript: text, transcriptIsFinal: meta.transcriptIsFinal, asrErrorCode: meta.asrErrorCode }
    if (!text) {
      // 不替用户造句：识别失败只提示，录音仍会作为失败样本随下一次打字提问留痕
      setVoiceInput(false)
      setError(
        meta.asrErrorCode && meta.asrErrorCode !== 'NO_SPEECH_DETECTED'
          ? '录音已保存，但语音识别失败。请直接打字提问，这段录音会作为识别失败样本一起记录。'
          : '录音已保存，但没有识别到有效语音。请说清楚些重试，或直接打字提问。'
      )
      return
    }
    setError('')
    setQuestion(text)
    setVoiceInput(true)
    notify(meta.transcriptIsFinal ? `已识别到语音：“${text}”，请确认后提交。` : `识别结果可能不完整：“${text}”，请核对后再提交。`)
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
    const fallback = pageStartMs(source.page_no - 1, book.pages, segments, durationMs)
    const target = source.start_ms ?? fallback.ms
    seek(target)
    notify(source.start_ms === null && !fallback.exact
      ? `按时长估算跳到第 ${source.page_no} 页附近 · ${formatTime(target)}（后端没有这一页的时间轴，位置可能不准）`
      : `已定位到第 ${source.page_no} 页 · ${formatTime(target)}`)
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

      {videoState && videoState.status !== 'ready' && (
        <div className="wf-warning" role="status" data-video-status={videoState.status} style={{ margin: '0 0 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            {videoState.status === 'loading'
              ? '正在向后端查询本次运行的视频…'
              : videoState.status === 'none'
                ? `后端尚未登记本次运行的视频（已登记产物 ${videoState.assetCount} 个，无 video/mp4），当前显示静态书页。`
                : `读取视频失败：${videoState.error}。当前显示静态书页。`}
          </span>
          {videoState.status !== 'loading' && onReloadVideo && (
            <Button variant="secondary" onClick={onReloadVideo}>
              重新检查视频
            </Button>
          )}
        </div>
      )}
      {videoState?.status === 'ready' && (
        <div className="notes-origin" role="status" data-video-status="ready" style={{ margin: '0 0 12px' }}>
          <Icon name="info" size={17} />
          <span>
            正在播放后端登记的视频产物（sha256 {videoState.sha256.slice(0, 12)}…，{(videoState.size_bytes / 1024).toFixed(0)} KB）。
          </span>
        </div>
      )}
      {book.pages_only && (
        <div className="wf-warning" role="status" style={{ margin: '0 0 12px' }}>
          后端分析尚未完成，当前只基于你校对过的书页文字回答，内容未经复核。
        </div>
      )}

      <div className="reader-layout">
        <section className="reader-workspace">
          <div className="reader-stage-heading">
            <Badge tone={appMode === 'live' ? 'green' : 'amber'}>
              {appMode === 'live' ? '后端交互模式 (Live)' : '演示模式 (本地模拟)'}
            </Badge>
            <span data-page-basis={pageBasis} title={pageBasisLabel(pageBasis)}>
              第 {currentPage + 1} / {pageCount} 页{pageBasis === 'estimated' || pageBasis === 'timeline_gap' ? '（估算）' : ''}
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
                  const el = event.currentTarget
                  const duration = el.duration
                  const realDuration = Number.isFinite(duration) && duration > 0 ? duration * 1000 : null
                  if (realDuration !== null) setDurationMs(realDuration)
                  setMetadataReady(true)
                  if (pendingSeek.current !== null) {
                    const next = realDuration !== null ? Math.min(realDuration, pendingSeek.current) : pendingSeek.current
                    pendingSeek.current = null
                    el.currentTime = next / 1000
                    setTimeMs(next)
                  }
                }}
                onTimeUpdate={(event) => setTimeMs(event.currentTarget.currentTime * 1000)}
                onEnded={() => setPlaying(false)}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                onError={() => {
                  // 视频加载失败：挂起的跳转永远不会执行，必须丢弃并让用户知道
                  if (pendingSeek.current !== null) {
                    pendingSeek.current = null
                    setError('视频加载失败，未能跳转到历史记录对应的时间点。')
                  }
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
            <p>{page?.ocr_text || '（本页暂无校对文字）'}</p>
          </div>

          <div className="reader-source-bar">
            <span>
              <Icon name="book" size={16} />
              来源：第 {currentPage + 1} 页{pageBasis === 'estimated' || pageBasis === 'timeline_gap' ? '（估算，非时间轴）' : ''}
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
                onClick={() => seek(pageStartMs(index, book.pages, segments, durationMs).ms)}
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
                ? '提问交互留痕直连后端；语音使用浏览器 Web Speech 普通话识别。'
                : '当前为演示模式，回答使用示例逻辑。'}
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              const voice = pendingVoice.current ?? undefined
              pendingVoice.current = null
              void ask(question, voiceInput ? 'speech' : 'keyboard', voice)
              setVoiceInput(false)
            }}
          >
            <label htmlFor="reader-question">想问故事什么呢？</label>
            <textarea
              id="reader-question"
              maxLength={500}
              value={question}
              onChange={(event) => { setQuestion(event.target.value); setVoiceInput(false) }}
              placeholder={`针对《${book.title}》提出一个问题，例如关于画面、情节或角色…`}
              disabled={Boolean(busy) || isRecording}
            />

            {/* 真实录音提问 (D1)：录音 + 浏览器普通话识别，录音可回放/保存 */}
            <div style={{ marginBottom: '10px' }}>
              <AudioRecorder onRecordingComplete={handleRecording} onRecordingChange={setIsRecording} disabled={Boolean(busy)} />
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
                    if (lastAction.kind === 'question') void ask(lastAction.text, lastAction.inputMethod, lastAction.voice)
                    else void touch(lastAction.x, lastAction.y, lastAction.box, lastAction.detail, lastAction.videoMs)
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
                <small>{latest.origin === 'mock' ? '演示模式' : '本地切片检索（无外部模型服务）'}</small>
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
