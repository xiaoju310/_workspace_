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

export interface ApiDeps {
  client?: TransportClient;
  /** 可选的外部模型服务地址（配置了就走它，未配置走本地抽取式检索） */
  modelServiceUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface AskContext {
  /** 当前图书的证据索引（由 buildSlicesFromBook 构建）。Live 必须提供，否则只能拒答 */
  indexer?: TimeSliceIndexer;
}
export interface TouchContext {
  /** 当前 run 的时间轴(来自 A)，用于给触控点附上真实字幕依据 */
  segments?: SegmentOut[];
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
        audio_present: Boolean(audioBlob),
      },
      {
        answer: data.answer,
        evidence: data.evidence,
        status: data.status,
        answer_source: data.answer_source,
        uncertain: data.status !== 'success',
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
    const t0 = nowMs();
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
      data = await this.callModelService<TouchRecognitionResponse>('/interaction/touch', params, 3000);
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
      },
      {
        status: data.status,
        target: data.target_name,
        explanation: data.explanation,
        confidence: data.confidence,
        evidence: data.evidence ? [data.evidence] : [],
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

  async createBook(input: { title: string; authorization_ref: string }) {
    return this.client.createBook(input);
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
}

export const apiClient = new ApiClient();
