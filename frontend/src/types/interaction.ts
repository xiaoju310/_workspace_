/**
 * 纸书智伴 - 交互模块类型定义 (TypeScript)
 * 对应赛题要求与个人任务书规范：
 * - 语音问答 (ASR/检索/短答/TTS)
 * - 触控万物识别 (坐标归一化/黑边过滤/实体定位)
 * - 性能度量 (首字/首音频耗时、缓存命中标识)
 * - 通用阅读扩展 (分类确认/笔记审核与分享)
 */

// ==================== 1. 基础公共类型 ====================

export type InteractionStatus = 'idle' | 'recording' | 'processing' | 'success' | 'no_evidence' | 'error';

/** 证据来源类型 */
export type EvidenceType = 'page' | 'script' | 'video_frame' | 'none';

/** 结构化证据 */
export interface EvidenceSource {
  page_no: number;
  video_start_ms: number;
  video_end_ms: number;
  evidence_type: EvidenceType;
  confidence: number;
  snippet: string;
  thumbnail_url?: string;
}

/** 交互延迟指标（毫秒） */
export interface LatencyMetrics {
  asr_ms?: number;
  retrieval_ms?: number;
  llm_first_token_ms?: number;
  llm_total_ms?: number;
  tts_first_audio_ms?: number;
  tts_total_ms?: number;
  total_roundtrip_ms: number;
  client_recorded_ms?: number;
}

// ==================== 2. 语音问答契约 ====================

/** 问答请求 Payload (发送给后端 /api/v1/interaction/qa) */
export interface AskQuestionRequest {
  book_id: string;
  run_id: string;
  video_ms: number;
  /** 语音转写文本（若前端完成 ASR，或纯文本测试） */
  query_text?: string;
  /** 音频格式，如 "audio/webm;codecs=opus" 或 "audio/wav" */
  audio_mime?: string;
  /** 是否流式响应（首期采用轮询/非流式稳定流程，保持 false） */
  stream?: boolean;
}

/** 问答响应 Payload */
export interface AskQuestionResponse {
  run_id: string;
  question: string;
  answer: string;
  status: 'success' | 'no_evidence' | 'error';
  confidence: number;
  evidence: EvidenceSource[];
  /** 语音回答音频 URL 或 Base64（TTS 合成结果） */
  audio_url?: string | null;
  /** 性能开销统计 */
  latency: LatencyMetrics;
  /** 是否命中缓存（必须显式标注，不能拿缓存冒充现场实时生成） */
  cache_hit: boolean;
  error_message?: string;
}

// ==================== 3. 触控万物识别契约 ====================

/** 触控画面归一化坐标 (0.0 ~ 1.0) 及真实像素 */
export interface TouchPoint {
  /** 归一化 X (相对于视频真实画面的比例 0~1) */
  norm_x: number;
  /** 归一化 Y (相对于视频真实画面的比例 0~1) */
  norm_y: number;
  /** 对应视频原始分辨率下的像素坐标 */
  video_pixel_x: number;
  video_pixel_y: number;
  /** 视频原始分辨率 */
  video_width: number;
  video_height: number;
}

/** 触控识别请求 Payload (/api/v1/interaction/touch) */
export interface TouchRecognitionRequest {
  book_id: string;
  run_id: string;
  video_ms: number;
  touch_point: TouchPoint;
  /** 客户端渲染窗口及黑边分布（供审计和排查） */
  viewport_info: {
    container_width: number;
    container_height: number;
    render_width: number;
    render_height: number;
    offset_x: number;
    offset_y: number;
    is_letterbox: boolean;
  };
}

/** 触控识别响应 Payload */
export interface TouchRecognitionResponse {
  run_id: string;
  video_ms: number;
  status: 'success' | 'uncertain' | 'out_of_bounds' | 'error';
  target_name: string;
  explanation: string;
  confidence: number;
  /** 目标物体的检测框归一化 [x_min, y_min, x_max, y_max] */
  bounding_box?: [number, number, number, number];
  evidence: EvidenceSource;
  latency_ms: number;
  cache_hit: boolean;
  error_message?: string;
}

// ==================== 4. 通用阅读扩展契约 ====================

export type BookCategory = 
  | 'picture_book'  // 绘本 (赛事主场景)
  | 'textbook'      // 教材
  | 'literature'    // 文学/小说
  | 'science'       // 科普百科
  | 'other';

export interface BookCategoryInfo {
  category: BookCategory;
  confidence: number;
  is_confirmed: boolean;
  confirmed_by?: string;
}

export interface ReadingNote {
  id: string;
  book_id: string;
  page_no: number;
  video_ms?: number;
  user_id: string;
  content: string;
  source_quote?: string;
  status: 'draft' | 'reviewed' | 'published';
  share_settings: {
    is_shared: boolean;
    share_token?: string;
    expires_at?: string | null;
    read_only: boolean;
  };
  created_at: string;
  updated_at: string;
}
