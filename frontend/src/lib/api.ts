import { ApiError, createApiClient } from '../api/client';
import type { ApiClient as TransportClient, InteractionIn } from '../api/client';
import type {
  AppMode,
  AskQuestionRequest,
  AskQuestionResponse,
  BackendNoteOut,
  BackendShareOut,
  ClassificationOut,
  EvidenceSource,
  SegmentOut,
  TouchRecognitionRequest,
  TouchRecognitionResponse,
} from '../types/interaction';
import { TimeSliceIndexer, demoTimeSliceIndexer } from '../features/interaction/indexing/TimeSliceIndexer';
import { pictureBookRagEngine } from '../features/interaction/qa/PictureBookRagEngine';
import { blobToBase64 } from '../features/interaction/frameCapture';

/**
 * 角色 C 的业务层（语音问答 / 触控认物 / 交互留痕 / 笔记生命周期）。
 * 传输层统一复用 `api/client.ts`（超时、detail 解析、422 可读化、令牌脱敏），不再自带一套 fetch。
 *
 * 诚实性铁律（每条都有单测，见 __tests__/InteractionApi.test.ts）：
 *  1. Live 路径里不存在任何内置故事数据；索引必须由调用方传入"当前这本书"；
 *  2. Live 没有视觉模型时，触控只如实记录点击并返回 uncertain，不编造物体名/置信度/包围框；
 *  3. 写入后端失败 → 响应带 persisted=false 与原因，调用方必须展示；
 *  4. 所有读取接口失败一律抛错，不再吞成空数组；
 *  5. 不存在默认 token；A 的 Bearer 令牌绝不发往第三方模型服务。
 */

export const PRODUCER = 'c_interaction_agent';
const TOKEN_KEY = 'AUTH_BEARER_TOKEN';

/** 构造并校验写给 A 的交互载荷（纯函数，供单测直接调用） */
export function buildInteractionPayload(
  type: 'voice' | 'touch',
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  latencyMs: number
): InteractionIn {
  if (type !== 'voice' && type !== 'touch') throw new Error('交互类型无效');
  if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('延迟必须为非负数');
  if (!output || Object.keys(output).length === 0) throw new Error('output 不能为空');
  return {
    interaction_type: type,
    input,
    output: { ...output, producer: PRODUCER },
    latency_ms: Math.round(latencyMs),
  };
}

/**
 * 前端(D)的书籍类型 → A 后端枚举(picture_book/novel/textbook/science/other)。
 * 之前直接把 'fiction'/'nonfiction' 发给 A，会被 422 拒绝。
 * nonfiction 无法区分 textbook/science，统一归 'other'，需 A/D 约定后细化。
 */
export function toBackendBookType(type: string): ClassificationOut['predicted_type'] {
  switch (type) {
    case 'picture_book': return 'picture_book';
    case 'fiction': return 'novel';
    case 'nonfiction': return 'other';
    case 'novel': case 'textbook': case 'science': case 'other': return type;
    default: throw new Error('请选择一个有效的图书类型后再确认');
  }
}

/** A 的预测类型 → 前端 UI 类型（textbook/science 归 nonfiction；other 让主人自己选） */
export function fromBackendBookType(type: string): 'picture_book' | 'fiction' | 'nonfiction' | 'unknown' {
  switch (type) {
    case 'picture_book': return 'picture_book';
    case 'novel': return 'fiction';
    case 'textbook': case 'science': return 'nonfiction';
    default: return 'unknown';
  }
}

export interface ApiDeps {
  client?: TransportClient;
  /** 可选的外部模型服务地址（配置了就走它，未配置走本地抽取式检索） */
  modelServiceUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface AskContext {
  /** 当前图书的证据索引（由 buildSlicesFromBook 构建）。Live 必须提供，否则只能拒答 */
  indexer?: TimeSliceIndexer;
  /** 录音提问的元数据（与 audioBlob 一起传入） */
  voice?: { mimeType: string; durationMs: number; transcript: string; transcriptIsFinal: boolean; asrErrorCode?: string };
}

/** 音频内容指纹：A 没有音频上传接口，留痕只写指纹，E 用它核对用户导出的原始录音文件 */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 构造写入留痕的音频/转写字段（纯函数外壳，供单测直接调用） */
export async function buildVoiceInput(audioBlob: Blob | undefined, voice: AskContext['voice'], query: string) {
  if (!audioBlob) return { audio_present: false };
  return {
    audio_present: true,
    audio: {
      mime_type: voice?.mimeType ?? audioBlob.type ?? '',
      size_bytes: audioBlob.size,
      duration_ms: voice ? Math.round(voice.durationMs) : null,
      sha256: await sha256Hex(audioBlob),
      // 如实说明：原始音频没有上传到后端
      storage: 'browser_only',
    },
    asr_provider: 'browser_web_speech',
    asr_transcript: voice?.transcript ?? '',
    asr_transcript_final: voice?.transcriptIsFinal ?? null,
    asr_error: voice?.asrErrorCode ?? null,
    // 用户提交的问题与识别原文不同（手动改过，或识别失败后改为打字）
    transcript_edited: (voice?.transcript ?? '') !== query,
  };
}
export interface TouchContext {
  /** 当前 run 的时间轴(来自 A)，用于给触控点附上真实字幕依据 */
  segments?: SegmentOut[];
  /** 点击时显示的画面：视频（带登记产物的 id/sha256）或静态书页图；以及点击瞬间截图 */
  frame?: {
    kind: 'video' | 'page_image';
    page_no: number;
    asset_id?: string | null;
    asset_sha256?: string | null;
    snapshot?: Blob | null;
    snapshot_width?: number;
    snapshot_height?: number;
    snapshot_error?: string;
    /** 点击时刻 performance.now()：有则作为延迟起点，latency_ms 覆盖"点击 → 结果"（D9） */
    clicked_at?: number;
    capture_ms?: number;
    /** 截图那一帧的视频时间；与请求里的 video_ms 一起留痕 */
    frame_time_ms?: number | null;
    paused_on_click?: boolean;
  };
}

/** 点击时刻只接受有限、且不晚于现在的 performance.now() 值；否则视为没有（从请求开始计时） */
export function validClickedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= nowMs() ? value : null;
}

/** 构造写入留痕的画面来源字段：E 据此区分"点的是视频还是静态图"，并用截图指纹核对 */
export async function buildFrameInput(frame: TouchContext['frame']) {
  if (!frame) return { frame_source: { kind: 'unknown' }, latency_origin: 'request' };
  return {
    frame_source: {
      kind: frame.kind,
      page_no: frame.page_no,
      asset_id: frame.kind === 'video' ? frame.asset_id ?? null : null,
      asset_sha256: frame.kind === 'video' ? frame.asset_sha256 ?? null : null,
    },
    frame_snapshot: frame.snapshot
      ? {
          mime_type: frame.snapshot.type || 'image/jpeg',
          width: frame.snapshot_width ?? null,
          height: frame.snapshot_height ?? null,
          size_bytes: frame.snapshot.size,
          sha256: await sha256Hex(frame.snapshot),
          // A 没有截图上传接口：截图只发给已配置的视觉模型服务，不进后端
          storage: 'browser_only',
          capture_ms: frame.capture_ms ?? null,
          frame_time_ms: frame.kind === 'video' ? frame.frame_time_ms ?? null : null,
        }
      : { captured: false, reason: frame.snapshot_error ?? '未截图' },
    latency_origin: validClickedAt(frame.clicked_at) !== null ? 'click' : 'request',
    paused_on_click: frame.paused_on_click === true,
  };
}

function nowMs() {
  return performance.now();
}

export class ApiClient {
  private token: string;
  private client: TransportClient;
  private modelServiceUrl?: string;
  private fetchImpl: typeof fetch;

  constructor(deps: ApiDeps = {}) {
    this.token = this.loadToken();
    this.modelServiceUrl = deps.modelServiceUrl ?? (import.meta.env.VITE_MODEL_SERVICE_URL || undefined);
    this.fetchImpl = deps.fetchImpl ?? ((...a) => globalThis.fetch(...a));
    const origin =
      (import.meta.env.VITE_API_ORIGIN as string | undefined) ||
      (typeof location !== 'undefined' && location.origin.startsWith('http') ? location.origin : 'http://127.0.0.1:8000');
    this.client = deps.client ?? createApiClient(origin, { getToken: () => this.token });
  }

  private loadToken(): string {
    try {
      return (typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_KEY)) || '';
    } catch {
      return '';
    }
  }

  setToken(token: string) {
    this.token = token.trim();
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, this.token);
    } catch {
      /* 隐私模式下仍可在内存中使用 */
    }
  }

  getToken(): string {
    return this.token;
  }

  // ==================== 1. 语音/键盘问答 ====================

  async askQuestion(
    params: AskQuestionRequest,
    mode: AppMode,
    audioBlob?: Blob,
    ctx: AskContext = {}
  ): Promise<AskQuestionResponse> {
    const t0 = nowMs();
    const query = (params.query_text || '').trim();
    if (!query) throw new Error('提问内容为空，请输入问题或对准麦克风清晰提问');

    if (mode === 'demo') {
      const resp = await pictureBookRagEngine.generateAnswer({ ...params, query_text: query }, demoTimeSliceIndexer);
      resp.latency.total_roundtrip_ms = Math.round(nowMs() - t0);
      resp.is_demo_mock = true;
      resp.answer_source = 'demo_fixture';
      return resp;
    }

    // ---- Live ----
    if (!params.run_id || !params.run_id.trim()) {
      throw new Error('当前图书还没有关联运行任务(run_id)，无法留痕，请先完成生成。');
    }

    let data: AskQuestionResponse;
    if (this.modelServiceUrl) {
      data = await this.callModelService<AskQuestionResponse>('/interaction/qa', { ...params, query_text: query }, 4000);
      if (typeof data?.answer !== 'string' || !Array.isArray(data.evidence)) {
        throw new Error('模型服务返回格式无效（缺少 answer / evidence）');
      }
      data.answer_source = 'model_service';
    } else {
      data = await pictureBookRagEngine.generateAnswer({ ...params, query_text: query }, ctx.indexer ?? new TimeSliceIndexer([]));
      data.answer_source = 'local_extractive';
    }

    data.is_demo_mock = false;
    const latencyMs = Math.round(nowMs() - t0);
    data.latency = { ...data.latency, total_roundtrip_ms: latencyMs };

    const rec = await this.recordInteraction(
      params.run_id,
      'voice',
      {
        query,
        video_ms: params.video_ms,
        input_method: params.input_method ?? 'keyboard',
        ...(await buildVoiceInput(audioBlob, ctx.voice, query)),
      },
      {
        answer: data.answer,
        evidence: data.evidence,
        status: data.status,
        answer_source: data.answer_source,
        uncertain: data.status !== 'success',
        // 旧载荷没有这个字段：界面显示"缓存命中"，后端留痕里却查不到，回归项"cache_hit 是否真的记录"无法验证
        cache_hit: Boolean(data.cache_hit),
      },
      latencyMs
    );
    data.persisted = rec.ok;
    if (!rec.ok) data.persist_error = rec.error;
    return data;
  }

  // ==================== 2. 触控认物 ====================

  async recognizeTouch(
    params: TouchRecognitionRequest,
    mode: AppMode,
    ctx: TouchContext = {}
  ): Promise<TouchRecognitionResponse> {
    // 有点击时刻就从点击算起（含截图、读取时间轴）；只接受过去的、有限的时间戳
    const t0 = validClickedAt(ctx.frame?.clicked_at) ?? nowMs();
    const tp = params.touch_point;

    const outside =
      !(tp.norm_x >= 0 && tp.norm_x <= 1 && tp.norm_y >= 0 && tp.norm_y <= 1) ||
      tp.video_pixel_x < 0 || tp.video_pixel_x >= tp.video_width ||
      tp.video_pixel_y < 0 || tp.video_pixel_y >= tp.video_height;
    if (outside) {
      return {
        run_id: params.run_id,
        video_ms: params.video_ms,
        status: 'out_of_bounds',
        target_name: '',
        explanation: '点击位置位于画面有效范围之外，已由客户端黑边算法拦截（未上报）。',
        confidence: 0,
        evidence: null,
        latency_ms: Math.round(nowMs() - t0),
        cache_hit: false,
        is_demo_mock: mode === 'demo',
      };
    }

    if (mode === 'demo') {
      return {
        run_id: params.run_id,
        video_ms: params.video_ms,
        status: 'uncertain',
        target_name: '',
        explanation: `[演示模式] 点击位置 (${tp.norm_x.toFixed(2)}, ${tp.norm_y.toFixed(2)})，演示模式不做物体识别。`,
        confidence: 0,
        evidence: null,
        latency_ms: Math.round(nowMs() - t0),
        cache_hit: false,
        is_demo_mock: true,
      };
    }

    // ---- Live ----
    if (!params.run_id || !params.run_id.trim()) {
      throw new Error('当前图书还没有关联运行任务(run_id)，无法留痕，请先完成生成。');
    }

    let data: TouchRecognitionResponse;
    if (this.modelServiceUrl) {
      // 截图随识别请求发给视觉模型服务（契约待 B 确认；字段缺失时服务端只能用坐标）
      const frameImage = ctx.frame?.snapshot ? await blobToBase64(ctx.frame.snapshot) : undefined;
      data = await this.callModelService<TouchRecognitionResponse>(
        '/interaction/touch',
        { ...params, frame_kind: ctx.frame?.kind, frame_image_base64: frameImage, frame_mime_type: frameImage ? 'image/jpeg' : undefined },
        frameImage ? 6000 : 3000
      );
      if (typeof data?.target_name !== 'string' || typeof data.confidence !== 'number') {
        throw new Error('触控模型服务返回格式无效（缺少 target_name / confidence）');
      }
    } else {
      // 没有视觉模型：只记录点击，绝不编造物体名称/置信度/包围框
      const seg = (ctx.segments ?? []).find((s) => params.video_ms >= s.start_ms && params.video_ms < s.end_ms);
      const evidence: EvidenceSource | null = seg
        ? {
            page_no: seg.page_no,
            video_start_ms: seg.start_ms,
            video_end_ms: seg.end_ms,
            evidence_type: 'script',
            confidence: 0,
            snippet: seg.caption,
          }
        : null;
      data = {
        run_id: params.run_id,
        video_ms: params.video_ms,
        status: 'uncertain',
        target_name: '',
        explanation: seg
          ? `视觉识别模型尚未接入，仅记录了点击位置。该时刻的画面字幕：“${seg.caption}”`
          : '视觉识别模型尚未接入，仅记录了点击位置，无法确定点中的物体。',
        confidence: 0,
        evidence,
        latency_ms: 0,
        cache_hit: false,
      };
    }
    data.is_demo_mock = false;
    const latencyMs = Math.round(nowMs() - t0);
    data.latency_ms = latencyMs;

    const rec = await this.recordInteraction(
      params.run_id,
      'touch',
      {
        video_ms: params.video_ms,
        norm_x: tp.norm_x,
        norm_y: tp.norm_y,
        pixel_x: tp.video_pixel_x,
        pixel_y: tp.video_pixel_y,
        video_width: tp.video_width,
        video_height: tp.video_height,
        viewport_info: params.viewport_info,
        ...(await buildFrameInput(ctx.frame)),
      },
      {
        status: data.status,
        target: data.target_name,
        explanation: data.explanation,
        confidence: data.confidence,
        evidence: data.evidence ? [data.evidence] : [],
        cache_hit: Boolean(data.cache_hit),
        recognition: this.modelServiceUrl ? 'model_service' : 'not_connected',
      },
      latencyMs
    );
    data.persisted = rec.ok;
    if (!rec.ok) data.persist_error = rec.error;
    return data;
  }

  private async callModelService<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    // 注意：不携带 A 的 Bearer 令牌，避免泄露给第三方服务
    try {
      const res = await this.fetchImpl(`${this.modelServiceUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        credentials: 'omit',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e: any) {
      throw new Error(`外部模型服务请求失败: ${e?.message ?? e}`);
    }
  }

  // ==================== 3. 对接 A: 交互留痕 ====================

  /** 写入失败不抛异常，而是返回 {ok:false, error}，由调用方向用户展示 */
  async recordInteraction(
    runId: string,
    type: 'voice' | 'touch',
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    latencyMs: number
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const payload = buildInteractionPayload(type, input, output, latencyMs);
      await this.client.recordInteraction(runId, payload);
      return { ok: true };
    } catch (e: any) {
      const msg = e instanceof ApiError ? `${e.message}（${e.code}）` : String(e?.message ?? e);
      return { ok: false, error: msg };
    }
  }

  /** 失败抛错；空数组只代表"确实没有记录" */
  async fetchRemoteInteractions(runId: string): Promise<Record<string, unknown>[]> {
    return this.client.interactions(runId);
  }

  async getRunSegments(runId: string): Promise<SegmentOut[]> {
    return (await this.client.segments(runId)) as unknown as SegmentOut[];
  }

  async getRunAssets(runId: string) {
    return this.client.assets(runId);
  }

  /** 带令牌下载已登记产物（视频/音频/字幕）；A 会校验 sha256，被篡改时返回 409 */
  async getAssetContent(runId: string, assetId: string): Promise<Blob> {
    return this.client.assetContent(runId, assetId);
  }

  async createBook(input: { title: string; authorization_ref: string }) {
    return this.client.createBook(input);
  }
  async classifyBook(bookId: string) {
    return this.client.classifyBook(bookId);
  }
  async uploadPage(bookId: string, file: Blob, pageNo: number) {
    return this.client.uploadPage(bookId, file, pageNo);
  }
  async updatePageOcr(bookId: string, pageNo: number, text: string) {
    return this.client.updatePage(bookId, pageNo, { ocr: { text } });
  }
  async analyzeBook(bookId: string) {
    return this.client.analyzeBook(bookId);
  }
  async runJobs(runId: string) {
    return this.client.runJobs(runId);
  }

  // ==================== 4. 对接 A: 分类确认 ====================

  async confirmCategory(bookId: string, confirmedType: string): Promise<ClassificationOut> {
    return (await this.client.confirmClassification(bookId, toBackendBookType(confirmedType))) as unknown as ClassificationOut;
  }

  // ==================== 5. 对接 A: 笔记与分享（状态以服务端为准） ====================

  async generateNoteDraft(bookId: string): Promise<BackendNoteOut> {
    const raw = (await this.client.generateNote(bookId)) as any;
    // 契约写 {note_id,status}，实现返回完整对象；两种都兼容
    const id = raw.id ?? raw.note_id;
    if (!id) throw new Error('服务端未返回笔记 ID');
    return { ...raw, id } as BackendNoteOut;
  }
  async getNote(noteId: string): Promise<BackendNoteOut> {
    return (await this.client.getNote(noteId)) as unknown as BackendNoteOut;
  }
  async updateNote(noteId: string, content: Record<string, unknown>): Promise<BackendNoteOut> {
    return (await this.client.updateNote(noteId, content)) as unknown as BackendNoteOut;
  }
  async reviewNote(noteId: string, action: 'approve' | 'revise'): Promise<BackendNoteOut> {
    return (await this.client.reviewNote(noteId, action)) as unknown as BackendNoteOut;
  }
  async createNoteShare(
    noteId: string,
    shareMode: 'link' | 'invite_only' = 'link',
    opts: { shared_user_id?: string; expires_at?: string } = {}
  ): Promise<BackendShareOut> {
    return (await this.client.createShare(noteId, { share_mode: shareMode, ...opts })) as unknown as BackendShareOut;
  }
  async revokeNoteShare(noteId: string, shareId: string): Promise<void> {
    await this.client.revokeShare(noteId, shareId);
  }
  async getSharedNote(token: string): Promise<BackendNoteOut> {
    return (await this.client.sharedNote(token)) as unknown as BackendNoteOut;
  }
  /** 指定用户分享：用访问者自己的令牌读取，服务端核验身份是否为被邀请人 */
  async getInvitedNote(noteId: string, shareId: string): Promise<BackendNoteOut> {
    return (await this.client.invitedNote(noteId, shareId)) as unknown as BackendNoteOut;
  }
}

export const apiClient = new ApiClient();
