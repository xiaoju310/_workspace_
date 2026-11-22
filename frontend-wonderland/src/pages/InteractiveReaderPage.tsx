import { FrameQuestion } from '../features/interaction/FrameQuestion'
import { VisualTextFinder } from '../features/interaction/VisualTextFinder'
import { TouchObjectOverlay } from '../features/interaction/TouchObjectOverlay'
import type { TouchPoint } from '../types/interaction'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { Interaction, ReaderProps, ReadingBookmark, Source, TouchDetail, VoiceCapture } from '../app/types'
import { Badge, Button, Icon, StatusPill } from '../components/ui'
import { SceneBackdrop } from '../components/PaperScene'
import { Doodle } from '../components/Doodles'
import { calculateImageTouchCoordinates, calculateVideoTouchCoordinates } from '../features/interaction/VideoCoordinateMapper'
import { apiClient } from '../lib/api'
import { AudioRecorder } from '../features/interaction/AudioRecorder'
import type { RecordingMeta } from '../features/interaction/AudioRecorder'
import { summarizeVoiceSamples } from '../features/interaction/voiceMetrics'
import type { VoiceSample } from '../features/interaction/voiceMetrics'
import { ttsManager } from '../features/interaction/tts/TtsProvider'
import { TtsPlayerWidget } from '../features/interaction/tts/TtsPlayerWidget'
import { captureFrame } from '../features/interaction/frameCapture'
import { pageBasisLabel, pageNoOf, pageStartMs, resolvePageAtTime } from '../features/interaction/pageTimeline'
import type { PageBasis } from '../features/interaction/pageTimeline'
import VocabularyCards from '../components/VocabularyCards'
import ReadingBookmarks from '../components/ReadingBookmarks'
import { resumeTimeMs } from '../features/books/readingPosition'
import { resolveEvidenceTarget, splitEvidenceText } from '../features/interaction/evidenceNavigation'

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
  pageIllustrationUrl,
  onReaderPageChange,
  onReadingPosition,
  onVocabularyChange,
  onBookmarksChange,
  focusMode = false,
  onFocusModeChange,
  onReloadVideo,
  segments,
}: ReaderProps) {
  useEffect(() => { if(book.run_id)apiClient.startReaderSession(book.run_id) },[book.id,book.run_id,appMode])
  const focusToggle = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef(focusMode)
  const [playing, setPlaying] = useState(false)
  const [timeMs, setTimeMs] = useState(()=>resumeTimeMs(book,36000,false))
  const positionTouched=useRef(false)
  const resumeBook=useRef(book)
  const videoKey=videoState?.status==='ready'?`${videoState.asset_id}:${videoState.sha256}`:undefined
  const [durationMs, setDurationMs] = useState(36000)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState<'question' | 'touch' | null>(null)
  const [error, setError] = useState('')
  const [videoError, setVideoError] = useState(false)
  const [result, setResult] = useState<Interaction | null>(null)
  const [touchMode, setTouchMode] = useState(false)
  const [cloudTouchEnabled, setCloudTouchEnabled] = useState(false)
  const [touchMarker, setTouchMarker] = useState<{ x: number; y: number; videoMs: number; pageIndex: number; point: TouchPoint } | null>(null)
  const operationPending = useRef(false)
  useEffect(() => {
    const sync = () => setCloudTouchEnabled(appMode === 'live' && Boolean(book.run_id) && apiClient.cloudInteractionsEnabled(book.run_id!))
    sync()
    return apiClient.subscribeCloudInteractions(sync)
  }, [appMode, book.id, book.run_id])
  const [activeEvidence, setActiveEvidence] = useState<Source | null>(null)
  const [previewKind, setPreviewKind] = useState<'evidence' | 'bookmark'>('evidence')
  const previewTitle = previewKind === 'bookmark' ? '书签原书页' : '答案依据'
  const evidenceOrigin = useRef<{ ms: number | null } | null>(null)
  const evidencePanel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!activeEvidence) return
    evidencePanel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    evidencePanel.current?.focus({ preventScroll: true })
  }, [activeEvidence])
  // 重试必须重放"完全相同"的请求：旧实现重试触控时丢掉了 touch_point/viewport_info（Live 直接报错），
  // 重试提问时 inputMethod 已被提交时重置，语音提问会被记成键盘输入
  const [lastAction, setLastAction] = useState<
    | { kind: 'question'; text: string; inputMethod: 'speech' | 'keyboard'; voice?: VoiceCapture; pageNo?: number | null; videoMs: number }
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
  const [localAsrConsent,setLocalAsrConsent]=useState(false)
  const [localAsrAvailable,setLocalAsrAvailable]=useState(false)
  const [speechLanguage,setSpeechLanguage]=useState<'zh-CN'|'en-US'>('zh-CN')
  const [localLanguages,setLocalLanguages]=useState<string[]>([])
  const [autoVoice,setAutoVoice]=useState(false)
  const [voiceSamples,setVoiceSamples]=useState<VoiceSample[]>([])
  const [autoPlayback,setAutoPlayback]=useState<{id:string;sampleId:string}|null>(null)
  const voiceSequence=useRef(0)
  const recordingScope = `${book.id}:${book.run_id}:${book.video_url}:${appMode}:${speechLanguage}`
  const activeRecordingScope = useRef(recordingScope)
  activeRecordingScope.current = recordingScope
  function cancelVoicePlayback() {
    setAutoPlayback(null)
    ttsManager.stop()
    setVoiceSamples(current=>current.map(sample=>['requesting','answer_ready'].includes(sample.status)?{...sample,status:'cancelled'}:sample))
  }
  function updateVoiceSample(id:string,patch:Partial<VoiceSample>) {
    setVoiceSamples(current=>current.map(sample=>sample.id===id?{...sample,...patch}:sample))
  }
  const localLanguageAvailable=localAsrAvailable&&localLanguages.includes(speechLanguage)

  useEffect(()=>{
    let stopped=false
    setLocalAsrConsent(false);setLocalAsrAvailable(false);setLocalLanguages([])
    if(appMode==='live')void apiClient.speechCapabilities().then(c=>{if(!stopped){setLocalAsrAvailable(c.asr_available);setLocalLanguages(c.languages??[])}}).catch(()=>{})
    return()=>{stopped=true}
  },[appMode,book.id])
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
  useEffect(() => { onReaderPageChange?.(currentPage) }, [currentPage, onReaderPageChange])
  // Periodic saves are throttled; pause/leave also flush the exact current position.
  // A loading/failed video must not overwrite its bookmark with a placeholder static page.
  const positionBucket=Math.floor(timeMs/5000)
  const positionSnapshot=useRef({book,isVideo,metadataReady,videoError,videoState,videoKey,durationMs,segments,onReadingPosition})
  positionSnapshot.current={book,isVideo,metadataReady,videoError,videoState,videoKey,durationMs,segments,onReadingPosition}
  function flushPosition() {
    const p=positionSnapshot.current
    if(!p.book.pages.length || (p.isVideo&&(!p.metadataReady||p.videoError)) || (!p.isVideo&&p.videoState?.status==='loading'))return
    if(!p.isVideo&&p.book.reading_position?.video&&!positionTouched.current)return
    const ms=Math.max(0,Math.min(p.durationMs,currentTime.current))
    const index=p.isVideo
      ? resolvePageAtTime(ms,p.book.pages,p.segments,p.durationMs).index
      : Math.min(p.book.pages.length-1,Math.floor(ms/Math.max(1,p.durationMs/p.book.pages.length)))
    p.onReadingPosition?.(ms,index,p.isVideo,p.videoKey)
  }
  const flushRef=useRef(flushPosition)
  flushRef.current=flushPosition
  useEffect(()=>{flushRef.current()},[positionBucket,currentPage,playing,isVideo,metadataReady,onReadingPosition,videoState?.status])
  useEffect(()=>{
    const flush=()=>flushRef.current()
    const hidden=()=>{if(document.visibilityState==='hidden')flush()}
    window.addEventListener('pagehide',flush)
    document.addEventListener('visibilitychange',hidden)
    return()=>{
      window.removeEventListener('pagehide',flush)
      document.removeEventListener('visibilitychange',hidden)
      flush()
    }
  },[])
  const currentInteractions = interactions.filter((item) => item.book_id === book.id && (!book.run_id || item.run_id === book.run_id))
  const latest = result ?? currentInteractions[0]

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestVersion.current += 1
      ttsManager.stop()
    }
  }, [])

  useEffect(() => {
    invalidateInteraction()
    setTouchMode(false)
    pendingVoice.current=null
    setQuestion('');setVoiceInput(false);setIsRecording(false);setAutoVoice(false);setVoiceSamples([])
  }, [book.id, book.run_id, book.video_url, appMode])

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
    invalidateInteraction()
    positionTouched.current=true
    // 旧实现：视频元数据到达前 durationMs 还是 36 秒占位值，历史里 50 秒的证据会被夹到 36 秒
    if (isVideo && !metadataReady) {
      pendingSeek.current = Math.max(0, seekTo)
      currentTime.current=Math.max(0,seekTo)
      setTimeMs(Math.max(0, seekTo))
      onSeekHandled()
      return
    }
    const next = Math.max(0, Math.min(durationMs, seekTo))
    currentTime.current=next
    setTimeMs(next)
    if (videoRef.current) videoRef.current.currentTime = next / 1000
    onSeekHandled()
  }, [seekTo, durationMs, onSeekHandled, isVideo, metadataReady])

  function invalidateInteraction() {
    requestVersion.current += 1
    cancelVoicePlayback()
    operationPending.current = false
    touchPending.current = false
    setBusy(null)
    setError('')
    setLastAction(null)
    setTouchMarker(null)
    setResult(null)
  }

  // Changing position must not let a late screenshot/result overwrite the new page.
  function seek(value: number) {
    invalidateInteraction()
    positionTouched.current=true
    if (isVideo && !metadataReady) {
      // 时长未知时不能按 36 秒占位值截断；等元数据到达后再执行
      pendingSeek.current = Math.max(0, value)
      currentTime.current=Math.max(0,value)
      setTimeMs(Math.max(0, value))
      return
    }
    const next = Math.max(0, Math.min(durationMs, value))
    currentTime.current=next
    setTimeMs(next)
    if (videoRef.current) videoRef.current.currentTime = next / 1000
  }

  // The run timeline can arrive after metadata; refine a page-based resume once it does.
  useEffect(()=>{
    if(!isVideo||!metadataReady||positionTouched.current||!segments?.length)return
    const next=resumeTimeMs(resumeBook.current,durationMs,true,videoKey,segments)
    currentTime.current=next
    setTimeMs(next)
    if(videoRef.current)videoRef.current.currentTime=next/1000
  },[segments,metadataReady,isVideo,durationMs,videoKey])

  async function togglePlayback() {
    if (busy || touchPending.current || operationPending.current) return
    setTouchMarker(null)
    positionTouched.current=true
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

  async function ask(text: string, inputMethod: 'speech' | 'keyboard' = 'keyboard', voice?: VoiceCapture, retryPageNo?: number | null, retryVideoMs?: number, sampleId?: string) {
    if (operationPending.current || touchPending.current) return
    const trimmed = text.trim()
    if (!trimmed) {
      setError('提问内容不能为空，请通过语音或键盘输入问题。')
      return
    }
    operationPending.current = true
    cancelVoicePlayback()
    if(sampleId)updateVoiceSample(sampleId,{requestStartedAt:performance.now(),status:'requesting'})
    setBusy('question')
    setTouchMarker(null)
    setError('')
    setTtsFirstAudioMs(null)
    const questionMs = retryVideoMs ?? currentTime.current
    const at = isVideo ? resolvePageAtTime(questionMs, book.pages, segments, durationMs) : null
    const pageNo = retryVideoMs !== undefined ? retryPageNo : at ? (at.exact ? at.pageNo : null) : pageNoOf(book.pages[currentPage] ?? {}, currentPage)
    setLastAction({ kind: 'question', text: trimmed, inputMethod, voice, pageNo, videoMs: questionMs })
    const version = requestVersion.current
    try {
      const item = await askQuestion(trimmed, questionMs, inputMethod, voice, pageNo)
      if (mounted.current && requestVersion.current === version) {
        setResult(item)
        setTtsFirstAudioMs(null)
        onInteraction(item)
        if(sampleId){updateVoiceSample(sampleId,{answerAt:performance.now(),status:'answer_ready'});setAutoPlayback({id:item.id,sampleId})}
      }
    } catch (cause: any) {
      if (mounted.current && requestVersion.current === version) {
        if(sampleId)updateVoiceSample(sampleId,{status:'request_failed'})
        setError(cause instanceof Error ? cause.message : '提问请求失败，请检查后端服务。')
      }
    } finally {
      if (mounted.current && requestVersion.current === version) {
        operationPending.current = false
        setBusy(null)
      }
    }
  }

  async function touch(x: number, y: number, box: { width: number; height: number }, detail?: TouchDetail, videoMs = currentTime.current) {
    if (operationPending.current) return
    operationPending.current = true
    setBusy('touch')
    setResult(null)
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
        operationPending.current = false
        setBusy(null)
      }
    }
  }

  // 严格按队长 Review 意见：真实黑边过滤与归一化计算，通过 3/3 单元测试覆盖
  function clickFrame(event: MouseEvent<HTMLDivElement>) {
    if (!touchMode || busy || touchPending.current || operationPending.current || isRecording || videoError) return
    const element = videoRef.current ?? imageRef.current
    if (!element) return
    if (!isVideo && !page?.image_url) {
      // 没有真实书页图片时显示的是占位插画：点它得到的坐标与这本书无关，不能上报
      setError('当前页没有书页图片（显示的是占位插画），无法进行触控认物。')
      return
    }

    const calculation =
      element instanceof HTMLVideoElement
        ? calculateVideoTouchCoordinates(event.nativeEvent, element)
        : calculateImageTouchCoordinates(event.nativeEvent, element as HTMLImageElement)
    if (!calculation.isInsideVideo || !calculation.touchPoint || !calculation.viewport) {
      setError((calculation.reason || '点击处于画面黑边留白区域，已自动拦截。请点击画面内的故事物体。'))
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
      currentTime.current = clickVideoMs
      setTimeMs(clickVideoMs)
    } else {
      pausedOnClick = playing
    }
    setPlaying(false)
    // 页码用点击那一刻的视频时间换算（clickVideoMs），不能用渲染状态里的 currentPage：它来自约 250ms 一次的 timeupdate，且在没有时间轴时只是估算。
    // 只有后端时间轴命中（或静态书页）才记确定页码；否则记 null 并写明依据，不声称知道点的是哪一页。
    const clicked = element instanceof HTMLVideoElement ? resolvePageAtTime(clickVideoMs, book.pages, segments, durationMs) : null
    const clickedBasis: PageBasis = clicked ? clicked.basis : 'page_image'
    const pageNo = clicked ? (clicked.exact ? clicked.pageNo : null) : pageNoOf(book.pages[currentPage] ?? {}, currentPage)
    const bounds = event.currentTarget.getBoundingClientRect()
    setTouchMarker({ x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100, videoMs: clickVideoMs, pageIndex: clicked?.index ?? currentPage, point: touchPoint })
    setBusy('touch')
    setError('')
    setResult(null)
    setLastAction(null)
    const version = requestVersion.current
    touchPending.current = true
    // D8：点击瞬间截取当前画面（视频帧或书页图）；截图失败不阻断触控，只如实记录原因
    // D9：clicked_at 交给下游作为延迟起点，latency_ms = 点击 → 拿到识别结果（含截图耗时）
    void captureFrame(element)
      .then((shot) => {
        if (!mounted.current || requestVersion.current !== version) return
        return touch(
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
      })
      .catch(() => {
        if (mounted.current && requestVersion.current === version) setError('画面截取失败，请重新点击物体。')
      })
      .finally(() => {
        if (mounted.current && requestVersion.current === version) {
          touchPending.current = false
          operationPending.current = false
          setBusy(null)
        }
      })
  }

  function handleRecording(blob: Blob, mimeType: string, transcript: string, meta: RecordingMeta) {
    const text = transcript.trim()
    if(!mounted.current||activeRecordingScope.current!==recordingScope||operationPending.current||touchPending.current)return
    const canAuto=autoVoice&&blob.size>0&&Boolean(text)&&meta.transcriptIsFinal&&!meta.asrErrorCode
    const sampleId=String(++voiceSequence.current)
    if(autoVoice)setVoiceSamples(current=>[...current,{id:sampleId,language:speechLanguage,
      stoppedAt:meta.recordingStoppedAt??null,asrCompletedAt:meta.asrCompletedAt??null,
      status:!text?'recognition_failed':canAuto?'requesting':'needs_confirmation'}])
    pendingVoice.current = blob.size ? { blob, mimeType, durationMs: meta.durationMs, transcript: text, transcriptIsFinal: meta.transcriptIsFinal, asrErrorCode: meta.asrErrorCode, asrProvider:meta.asrProvider, audioStorage:meta.audioStorage } : null
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
    if(canAuto){const voice=pendingVoice.current!;pendingVoice.current=null;setVoiceInput(false);void ask(text,'speech',voice,undefined,undefined,sampleId);return}
    notify(meta.transcriptIsFinal ? `已识别到语音：“${text}”，请确认后提交。` : `识别结果可能不完整：“${text}”，请核对后再提交。`)
  }

  useEffect(() => {
    if (focusMode) setTouchMode(false)
    if (previousFocus.current !== focusMode) focusToggle.current?.focus({ preventScroll: true })
    previousFocus.current = focusMode
  }, [focusMode])

  const evidenceTarget = activeEvidence
    ? resolveEvidenceTarget(activeEvidence, book.pages, segments, isVideo && metadataReady ? durationMs : undefined)
    : null
  const evidencePage = evidenceTarget?.ok ? book.pages[evidenceTarget.pageIndex] : null
  const evidenceText = splitEvidenceText(evidencePage?.edit_text ?? evidencePage?.ocr_text ?? '', activeEvidence?.quote ?? '')

  function pauseForEvidence() {
    videoRef.current?.pause()
    setPlaying(false)
    setTouchMode(false)
  }

  function goSource(source: Source, kind: 'evidence' | 'bookmark' = 'evidence') {
    const target = resolveEvidenceTarget(source, book.pages, segments, isVideo && metadataReady ? durationMs : undefined)
    if (!target.ok) { notify(target.message); return }
    // Keep the first pre-jump position even when switching among several citations.
    if (evidenceOrigin.current === null) {
      const mediaMs = videoRef.current && metadataReady ? videoRef.current.currentTime * 1000 : currentTime.current
      evidenceOrigin.current = { ms: isVideo && !metadataReady ? null : mediaMs }
    }
    positionTouched.current = true
    pauseForEvidence()
    setPreviewKind(kind)
    setActiveEvidence(source)
    if (!isVideo) {
      seek(pageStartMs(target.pageIndex, book.pages, undefined, durationMs).ms)
      notify(`已打开第 ${target.pageNo} 页${kind === 'bookmark' ? '书签原书页' : '答案依据'}`)
    } else if ((kind === 'bookmark' || source.source !== 'original_page') && target.videoMs !== null && metadataReady && !videoError) {
      seek(target.videoMs)
      notify(`已定位视频 ${formatTime(target.videoMs)}，并打开第 ${target.pageNo} 页${kind === 'bookmark' ? '书签原书页' : '依据'}`)
    } else {
      notify(`已打开第 ${target.pageNo} 页${kind === 'bookmark' ? '书签原书页' : '原文依据'}${kind === 'bookmark' ? '；可在原书页查看内容，视频仅在有可靠时间轴时定位。' : target.message ? `；${target.message}` : ''}`)
    }
  }

  function openBookmark(bookmark: ReadingBookmark) {
    const index = book.pages.findIndex(page => page.id === bookmark.page_id)
    if (index < 0) { notify('书签对应的原书页已移除，无法跳转。'); return }
    goSource({ page_no: pageNoOf(book.pages[index], index), source: 'original_page', quote: '', start_ms: null, end_ms: null }, 'bookmark')
  }

  function returnFromEvidence() {
    pauseForEvidence()
    if (evidenceOrigin.current?.ms !== null && evidenceOrigin.current?.ms !== undefined) seek(evidenceOrigin.current.ms)
    evidenceOrigin.current = null
    setActiveEvidence(null)
    notify(previewKind === 'bookmark' ? '已返回查看书签前的位置，点击播放可继续阅读。' : '已返回查看依据前的位置，点击播放可继续阅读。')
  }

  if (state !== 'success') {
    return (
      <div className={`page-content reader-page${focusMode ? ' reader-focus' : ''}`}>
        <SceneBackdrop tone="deep" />
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
            <Button onClick={() => navigate('progress')}>查看生成进度<Icon name="arrow" size={17} /></Button>
          ) : null}
        </section>
      </div>
    )
  }

  if ((book.status !== 'READY' || !book.safety_reviewed) && !book.pages_only) {
    return (
      <div className={`page-content reader-page${focusMode ? ' reader-focus' : ''}`}>
        <SceneBackdrop tone="deep" />
        <section className="reader-state">
          <Icon name="lock" size={32} />
          <h2>这段阅读，还需要一点准备。</h2>
          <p>完成书页校对、分类确认、生成流程与主人内容复核后，再开启伴读。</p>
          <Button onClick={() => navigate('progress', book.id)}>查看生成进度<Icon name="arrow" size={17} /></Button>
        </section>
      </div>
    )
  }

  return (
    <div className={`page-content reader-page${focusMode ? ' reader-focus' : ''}`}>
      <div className="page-heading reader-heading">
        <div>
          <p className="eyebrow">READ, ASK, DISCOVER</p>
          <h1>{focusMode ? `《${book.title}》` : '翻开故事，也打开好奇心。'}</h1>
          <p className="page-description">
            《{book.title}》 · {book.age_band || '适龄待复核'}
          </p>
        </div>
        <div className="reader-heading-actions">
          {onFocusModeChange && <button ref={focusToggle} type="button" className="button button-secondary focus-toggle"
            aria-pressed={focusMode} disabled={!focusMode && (isRecording || Boolean(busy))}
            title={!focusMode && (isRecording || busy) ? '请先结束录音或等待当前操作完成' : focusMode ? '退出专注阅读（Esc）' : '隐藏侧栏和问答，保留书页、翻页与书签'}
            onClick={() => onFocusModeChange(!focusMode)}>{focusMode ? '退出专注阅读' : '专注阅读'}</button>}
          {focusMode && <span className="reader-focus-hint">按 Esc 退出 · {book.origin === 'mock' ? '演示书页' : '原书内容'}</span>}
          <span className={`reader-mode-chip ${appMode === 'live' ? 'is-live' : 'is-demo'}`}>
            <Icon name={appMode === 'live' ? 'link' : 'sparkle'} size={14} />
            {appMode === 'live' ? '真实后端 · Live' : '演示模式 · Demo'}
          </span>
          <Button variant="secondary" onClick={() => navigate('history')}>
            会话历史<Icon name="clock" size={17} />
          </Button>
        </div>
      </div>

      {onBookmarksChange && <ReadingBookmarks key={book.id} book={book}
        currentPageId={evidencePage?.id ?? (((!isVideo && videoState?.status !== 'loading') || (isVideo && metadataReady && !videoError && pageAt?.exact)) ? page?.id ?? null : null)}
        onChange={onBookmarksChange} onOpen={openBookmark} />}

      {videoState && videoState.status !== 'ready' && (
        <div className="wf-warning reader-banner" role="status" data-video-status={videoState.status}>
          <span>
            {videoState.status === 'loading'
              ? '正在向后端查询本次运行的视频…'
              : videoState.status === 'none'
                ? `本次运行尚无可播放视频（已登记产物 ${videoState.assetCount} 个）。可在上方“让书页动起来”中单独生成，当前显示静态书页。`
                : `读取视频失败：${videoState.error}。当前显示静态书页。`}
          </span>
          {videoState.status !== 'loading' && onReloadVideo && (
            <Button variant="secondary" className="button--sm" onClick={onReloadVideo}>重新检查视频</Button>
          )}
        </div>
      )}
      {videoState?.status === 'ready' && (
        <div className="reader-banner reader-banner--ok" role="status" data-video-status="ready">
          <Icon name="info" size={17} />
          <span>
            正在播放后端登记的视频产物（sha256 {videoState.sha256.slice(0, 12)}…，{(videoState.size_bytes / 1024).toFixed(0)} KB）。
          </span>
        </div>
      )}
      {book.pages_only && (
        <div className="wf-warning reader-banner" role="status">
          后端分析尚未完成，当前只基于你校对过的书页文字回答，内容未经复核。
        </div>
      )}
      {!focusMode && pageIllustrationUrl && !isVideo && (
        <div className="reader-banner reader-banner--art" role="status">
          <span>B 生成的插画（非原书页，不用于触控认物）</span>
          <img src={pageIllustrationUrl} alt="本页生成插画" />
        </div>
      )}

      <div className="reader-layout">
        {/* 沉浸式舞台 */}
        <section className="reader-workspace">
          <div className="reader-stage-heading">
            <StatusPill tone={appMode === 'live' ? 'success' : 'waiting'} icon={appMode === 'live' ? 'link' : 'sparkle'}>
              {appMode === 'live' ? '后端交互模式 Live' : '演示模式 本地模拟'}
            </StatusPill>
            <span data-page-basis={pageBasis} title={pageBasisLabel(pageBasis)}>
              第 {currentPage + 1} / {pageCount} 页{pageBasis === 'estimated' || pageBasis === 'timeline_gap' ? '（估算）' : ''}
            </span>
          </div>

          <div
            className={`reader-frame ${touchMode ? 'touch-active' : ''}`}
            onClick={clickFrame}
            aria-label="阅读画面"
          >
            <div className="reader-film-grain" aria-hidden="true" />
            <span className="frame-corner frame-corner--tl" aria-hidden="true" />
            <span className="frame-corner frame-corner--br" aria-hidden="true" />

            <div className="reader-media-surface">
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
                  if(realDuration===null)return
                  const next=pendingSeek.current!==null
                    ? Math.max(0,Math.min(realDuration,pendingSeek.current))
                    : resumeTimeMs(resumeBook.current,realDuration,true,videoKey,segments)
                  pendingSeek.current=null
                  if (evidenceOrigin.current && evidenceOrigin.current.ms === null) evidenceOrigin.current.ms = next
                  el.currentTime=next/1000
                  currentTime.current=next
                  setTimeMs(next)
                  setMetadataReady(true)
                }}
                onTimeUpdate={(event) => {
                  if(!metadataReady)return
                  currentTime.current=event.currentTarget.currentTime*1000
                  setTimeMs(currentTime.current)
                }}
                onEnded={(event) => {currentTime.current=event.currentTarget.currentTime*1000;setTimeMs(currentTime.current);setPlaying(false);flushRef.current()}}
                onPause={(event) => {currentTime.current=event.currentTarget.currentTime*1000;setTimeMs(currentTime.current);setPlaying(false);flushRef.current()}}
                onPlay={() => {positionTouched.current=true;setPlaying(true)}}
                onError={() => {
                  // 视频加载失败：挂起的跳转永远不会执行，必须丢弃并让用户知道
                  if (pendingSeek.current !== null) {
                    pendingSeek.current = null
                    setError('视频加载失败，未能恢复指定播放位置；上次阅读记录仍保留。')
                  }
                  setVideoError(true)
                  setPlaying(false)
                }}
                aria-label="互动阅读视频"
              />
            ) : (
              <img
                ref={imageRef}
                src={page?.image_url || '/art/page-forest.svg'}
                alt={`《${book.title}》第 ${currentPage + 1} 页画面`}
              />
            )}
              <VisualTextFinder runId={book.run_id ?? undefined} scope={`${book.id}:${book.video_url}:${appMode}:${currentPage}`}
                pageNo={page?.server_page_no ?? undefined} live={appMode==='live'} videoRef={videoRef} imageRef={imageRef}
                assetId={videoState?.status==='ready'?videoState.asset_id:undefined}
                assetSha256={videoState?.status==='ready'?videoState.sha256:undefined}/>
              <FrameQuestion runId={book.run_id ?? undefined} scope={`${book.id}:${book.video_url}:${appMode}:${currentPage}`}
                pageNo={page?.server_page_no ?? undefined} live={appMode==='live'} videoRef={videoRef} imageRef={imageRef}
                assetId={videoState?.status==='ready'?videoState.asset_id:undefined}
                assetSha256={videoState?.status==='ready'?videoState.sha256:undefined}/>
              <TouchObjectOverlay item={result} point={touchMarker?.point}
                active={Boolean(touchMode && touchMarker && !busy && !playing && touchMarker.pageIndex === currentPage && Math.abs(touchMarker.videoMs - timeMs) < 100)} />
            </div>

            {touchMode && touchMarker && touchMarker.pageIndex === currentPage && Math.abs(touchMarker.videoMs - timeMs) < 100 && (
              <span className="touch-point-marker" aria-label="已选择的识物位置" style={{ left: `${touchMarker.x}%`, top: `${touchMarker.y}%` }} />
            )}

            <span className="frame-watermark">{isVideo ? `运行: ${book.run_id ?? '默认'}` : '静态书页'}</span>

            {touchMode && (
              <span className="touch-mode-tip">
                <Icon name="search" size={14} />点击识物：点一下物体，暂停画面并查看解释
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

          {activeEvidence && evidenceTarget?.ok && evidencePage && (
            <section className="reader-evidence-panel" ref={evidencePanel} tabIndex={-1} aria-label={`${previewTitle}详情`}>
              <div className="reader-evidence-heading">
                <h3>{previewTitle} · 第 {evidenceTarget.pageNo} 页</h3>
                <button type="button" onClick={returnFromEvidence}>返回刚才位置</button>
              </div>
              <p className="reader-evidence-kind">
                {activeEvidence.source === 'original_page' ? (previewKind === 'bookmark' ? '书签收藏的原书页' : '原书页依据') : activeEvidence.source === 'script' ? '讲解文字依据' : '视频画面依据'}
                {activeEvidence.source !== 'original_page' && Number.isFinite(activeEvidence.start_ms) && activeEvidence.start_ms! >= 0
                  ? ` · ${formatTime(activeEvidence.start_ms!)}${Number.isFinite(activeEvidence.end_ms) && activeEvidence.end_ms! > activeEvidence.start_ms! ? `—${formatTime(activeEvidence.end_ms!)}` : ''}` : ''}
              </p>
              <div className="reader-evidence-content">
                {evidencePage.image_url && <img src={evidencePage.image_url} alt={`${previewTitle}原书页：第 ${evidenceTarget.pageNo} 页`} />}
                <div>
                  {previewKind !== 'bookmark' && <><h4>引用文字</h4>
                  {activeEvidence.quote?.trim() ? <blockquote>{activeEvidence.quote}</blockquote> : <p>这条依据未附引用文字，请核对书页内容。</p>}</>}
                  <h4>本页校对文字</h4>
                  <p className="reader-evidence-text">{evidenceText.before}{evidenceText.match && <mark>{evidenceText.match}</mark>}{evidenceText.after || (!evidenceText.before && !evidenceText.match ? '本页暂无文字，可查看原书页图片。' : '')}</p>
                  {activeEvidence.quote?.trim() && !evidenceText.match && <p className="reader-evidence-hint">引用文字未在本页校对文字中逐字匹配，可能来自讲解或画面；请结合原书页核对。</p>}
                </div>
              </div>
              {isVideo && <div className="reader-evidence-actions">
                {evidenceTarget.message && <p role="status">{previewKind === 'bookmark' ? '没有可靠的视频时间点，请查看上方书签原书页。' : evidenceTarget.message}</p>}
                {!metadataReady && !videoError && <p role="status">视频正在载入，时长就绪后可定位。</p>}
                {videoError && <p role="status">视频暂时无法播放，仍可核对上方原书页。</p>}
                <button type="button" disabled={evidenceTarget.videoMs === null || !metadataReady || videoError}
                  onClick={() => {
                    if (evidenceTarget.videoMs === null || !metadataReady || videoError) return
                    pauseForEvidence(); seek(evidenceTarget.videoMs)
                    notify(`已定位视频 ${formatTime(evidenceTarget.videoMs)}，保持暂停供核对。`)
                  }}>{previewKind === 'bookmark' ? '定位书页视频' : '定位依据视频'}{evidenceTarget.videoMs !== null ? ` · ${formatTime(evidenceTarget.videoMs)}` : ''}</button>
              </div>}
            </section>
          )}

          {/* 播放控制：悬浮纸艺控制条 */}
          <div className="reader-controls">
            <button
              className="play-toggle"
              disabled={Boolean(busy) || videoError}
              onClick={() => void togglePlayback()}
              aria-label={playing ? '暂停播放' : '开始播放'}
            >
              <Icon name={playing ? 'pause' : 'play'} size={20} />
            </button>
            <span className="play-time">{formatTime(timeMs)}</span>
            <input
              className="play-range"
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
              disabled={Boolean(busy) || isRecording || videoError}
              aria-pressed={touchMode}
              onClick={() => {
                setTouchMode((value) => !value)
                setTouchMarker(null)
                setError('')
              }}
            >
              <Icon name="search" size={15} />
              {touchMode ? '退出识物' : '点击识物'}
            </button>
          </div>

          <div className="reader-subtitle">
            <span className="subtitle-label"><Icon name="quote" size={13} />字幕</span>
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

          {focusMode && <nav className="reader-focus-paging" aria-label="专注阅读翻页">
            <button type="button" disabled={currentPage <= 0} onClick={() => seek(pageStartMs(currentPage - 1, book.pages, isVideo ? segments : undefined, durationMs).ms)}>上一页</button>
            <span>第 {page ? pageNoOf(page, currentPage) : currentPage + 1} 页 / 共 {book.pages.length} 页{isVideo && !pageAt?.exact ? '（估算）' : ''}</span>
            <button type="button" disabled={currentPage >= book.pages.length - 1} onClick={() => seek(pageStartMs(currentPage + 1, book.pages, isVideo ? segments : undefined, durationMs).ms)}>下一页</button>
          </nav>}

          {touchMode && (
            <section className="reader-touch-panel" aria-label="点击识物" aria-busy={busy === 'touch'}>
              <h3>点一点，认识画面中的物体</h3>
              <p>点击原书页或视频里的物体，播放会自动暂停。识别结束后，点击播放按钮继续阅读。</p>
              {appMode === 'live' ? (
                <label className="reader-touch-consent">
                  <input type="checkbox" checked={cloudTouchEnabled} disabled={!book.run_id || !book.server_book_id || Boolean(busy)}
                    onChange={event => {
                      if (!book.run_id) return
                      apiClient.enableCloudInteractions(book.run_id, event.target.checked)
                      setCloudTouchEnabled(event.target.checked)
                    }} />
                  我同意本次开启云端问答与识物，将书页/当前画面发送给豆包，可能按次收费；刷新或退出登录后失效。
                </label>
              ) : <p>演示模式仅记录点击位置，不会真实识别物体，也不会调用收费模型。</p>}
              {appMode === 'live' && !cloudTouchEnabled && <p>未开启云端识物：仅记录点击，不会猜测物体名称。真实识别需要服务器已配置视觉模型。</p>}
              <div role="status" aria-live="polite">
                {busy === 'touch' ? '已暂停画面，正在识别所点物体…' : touchMarker && result?.kind === 'touch' ? <><strong>{result.uncertain ? '暂时无法确定' : '识物结果'}</strong><p>{result.answer}</p>{result.recognized && !result.bounding_box && <p>已识别名称，但未取得可靠的物体边界框；不会用点击圆圈代替。</p>}</> : '开启后，直接点击画面中的物体。'}
              </div>
              {error && <p role="alert">{error}</p>}
              {error && lastAction?.kind === 'touch' && <button type="button" disabled={Boolean(busy)} onClick={() => void touch(lastAction.x, lastAction.y, lastAction.box, lastAction.detail, lastAction.videoMs)}>重新识别所选位置</button>}
            </section>
          )}

          <div className="reader-page-strip" aria-label="页码导航">
            {book.pages.map((item, index) => (
              <button
                key={item.id}
                className={index === currentPage ? 'selected' : ''}
                onClick={() => seek(pageStartMs(index, book.pages, isVideo ? segments : undefined, durationMs).ms)}
                aria-current={index === currentPage ? 'true' : undefined}
                aria-label={`第 ${pageNoOf(item, index)} 页`}
              >
                <img src={item.image_url || '/art/page-forest.svg'} alt="" />
                <span>第 {pageNoOf(item, index)} 页</span>
              </button>
            ))}
          </div>

          <div className="run-metadata">
            <Icon name="info" size={16} />
            <span>book_id: {book.id} · run_id: {book.run_id || '未关联'} · 模式: {appMode}</span>
          </div>
        </section>

        {/* 伴读助手 */}
        <aside className="reader-assistant" hidden={focusMode}>
          <div className="assistant-title">
            <span className="assistant-mark"><Icon name="spark" size={22} /></span>
            <div>
              <h2>伴读助手</h2>
              <p>好问题，让故事更有趣。</p>
            </div>
          </div>

          <div className="assistant-note">
            <Icon name="info" size={16} />
            <p>
              {appMode === 'live'
                ? '提问交互留痕直连后端；可选择中文或英文识别；自动模式仅提交已定稿文字，未定稿或失败仍需手动核对。云端问答仍需另行授权。'
                : '当前为演示模式，回答使用示例逻辑。'}
            </p>
          </div>

          <form
            className="assistant-form"
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
            <div className="assistant-recorder">
              <label>提问语言<select aria-label="提问语言" value={speechLanguage} disabled={isRecording||Boolean(busy)} onChange={e=>{setSpeechLanguage(e.target.value as 'zh-CN'|'en-US');setLocalAsrConsent(false)}}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
              <label><input aria-label="自动语音问答" type="checkbox" checked={autoVoice} disabled={isRecording||Boolean(busy)} onChange={e=>{setAutoVoice(e.target.checked);if(!e.target.checked)cancelVoicePlayback()}}/>识别定稿后自动提问并朗读答案（不自动授权云端；失败或未定稿需核对）</label>
              {appMode==='live'&&<label><input type="checkbox" checked={localAsrConsent} disabled={isRecording||Boolean(busy)||!localLanguageAvailable} onChange={e=>setLocalAsrConsent(e.target.checked)}/>浏览器识别失败时，允许把本次录音发送到当前服务器的本机识别组件；不调用云端、不另收费，临时文件处理后删除。{!localLanguageAvailable&&'（当前语言的服务器识别未就绪）'}</label>}
              <AudioRecorder key={recordingScope} language={speechLanguage} serverFallback={appMode==='live'&&localAsrConsent&&localLanguageAvailable?(audio,signal)=>apiClient.transcribeAudio(audio,signal,speechLanguage):undefined} onRecordingComplete={handleRecording} onRecordingChange={recording=>{if(!mounted.current||activeRecordingScope.current!==recordingScope)return;setIsRecording(recording);if(recording){cancelVoicePlayback();videoRef.current?.pause();setPlaying(false)}}} disabled={Boolean(busy)} />
              {voiceSamples.length>0&&<div role="status" aria-label="自动语音统计">
                自动语音样本 {voiceSamples.length} 条；浏览器播放启动≤2秒 {summarizeVoiceSamples(voiceSamples).withinTwoSeconds}/{voiceSamples.length}（含失败及待确认样本）。此指标不是实际可听首音，需录音验收。
                <Button type="button" variant="ghost" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({summary:summarizeVoiceSamples(voiceSamples),samples:voiceSamples},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='voice-session-metrics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>导出本次语音统计</Button>
              </div>}
            </div>

            <div className="question-options">
              <span>{question.length}/500 字 · 支持语音识别与键盘输入</span>
            </div>

            <Button type="submit" className="button--block" disabled={Boolean(busy) || isRecording}>
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
              <strong><Icon name="alert" size={16} />操作未完成</strong>
              <p>{error}</p>
              {lastAction && (
                <button
                  onClick={() => {
                    if (lastAction.kind === 'question') void ask(lastAction.text, lastAction.inputMethod, lastAction.voice, lastAction.pageNo, lastAction.videoMs)
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
                <small>{latest.origin === 'mock' ? '演示模式' : latest.kind === 'touch' ? (latest.recognized ? '基于点击画面的视觉识别，请结合书页核对' : '点击记录（未完成真实识别）') : '基于书页证据回答，请结合原文核对'}</small>
              </div>

              <p className="answer-text">{latest.answer}</p>

              {/* TTS 真实语音朗读组件 (C 交付) */}
              <div className="answer-tts">
                <TtsPlayerWidget textToSpeak={latest.answer} autoPlayKey={autoPlayback?.id===latest.id?autoPlayback.sampleId:undefined} onAudioFirstByte={setTtsFirstAudioMs}
                  onPlaybackStart={()=>{if(autoPlayback)setVoiceSamples(current=>current.map(sample=>sample.id===autoPlayback.sampleId&&sample.status==='answer_ready'?{...sample,playbackAt:performance.now(),status:'started'}:sample))}}
                  onPlaybackError={()=>{if(autoPlayback)setVoiceSamples(current=>current.map(sample=>sample.id===autoPlayback.sampleId&&sample.status==='answer_ready'?{...sample,status:'playback_failed'}:sample))}} />
              </div>

              {latest.transcript && <div className="answer-transcript">语音转写：{latest.transcript}</div>}

              <div className="answer-evidence">
                <span>回答依据与证据 · 点击查看原文或定位视频</span>
                {latest.sources && latest.sources.length ? (
                  latest.sources.map((source, index) => (
                    <button type="button" key={`${source.page_no}-${index}`} onClick={() => goSource(source)} aria-label={`查看答案依据 ${index + 1}：第 ${source.page_no} 页`} aria-pressed={activeEvidence === source}>
                      <Icon name="book" size={14} />
                      <span className="answer-evidence-summary">
                        <strong>依据 {index + 1} · 第 {source.page_no} 页</strong>
                        <span>{source.source === 'original_page' ? '查看原文' : '查看依据 / 定位视频'}{source.source !== 'original_page' && Number.isFinite(source.start_ms) && source.start_ms! >= 0 ? ` · ${formatTime(source.start_ms!)}` : ''}</span>
                        {source.quote?.trim() && <span className="answer-evidence-quote">{source.quote}</span>}
                      </span>
                      <Icon name="chevron" size={14} />
                    </button>
                  ))
                ) : (
                  <p className="answer-none">未命中确凿的单页或时间段证据，回答已标记为谨慎不确定。</p>
                )}
              </div>

              <div className="answer-metrics">
                <span>{latest.latency_ms === null ? '延迟未实测' : `请求延迟 ${latest.latency_ms} ms`}</span>
                {ttsFirstAudioMs !== null && <span>浏览器播放启动延迟 {ttsFirstAudioMs} ms</span>}
                <span>{latest.cached ? '缓存命中' : '实时生成'}</span>
                {latest.origin === 'real' && latest.persisted === false && (
                  <span className="answer-persist-error" role="alert">未写入后端：{latest.persist_error ?? '原因未知'}</span>
                )}
              </div>
            </section>
          ) : (
            <div className="assistant-empty">
              <Doodle name="rabbit" className="doodle--assistant" size={92} />
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

      {onVocabularyChange && <div hidden={focusMode}><VocabularyCards book={book}
        pageNo={evidenceTarget?.ok ? evidenceTarget.pageNo : ((!isVideo && videoState?.status !== 'loading') || (isVideo && metadataReady && !videoError && pageAt?.exact)) && page ? pageNoOf(page, currentPage) : null}
        onChange={onVocabularyChange} onSource={goSource} /></div>}

      <div className="home-footnote">
        <Icon name="lock" size={15} />
        <span>使用本地读者会话，不采集儿童个人隐私。所有问答与触控记录包含精确证据溯源与真实/模拟标记。</span>
      </div>
    </div>
  )
}
