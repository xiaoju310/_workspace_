/**
 * 纸书智伴 - 交互模块全量类型定义 (TypeScript)
 * 严格对齐后端 A 接口契约 (docs/api-contract.md) 与队长评审要求
 */

// ==================== 1. 系统运行模式 ====================
export type AppMode = 'live' | 'demo';

export type InteractionStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'transcribing'
  | 'retrieving'
  | 'generating'
  | 'synthesizing'
  | 'success'
  | 'no_evidence'
  | 'error';

export type AsrErrorCode =
  | 'MICROPHONE_DENIED'
  | 'NO_SPEECH_DETECTED'
  | 'AUDIO_RECORD_FAILED'
  | 'TRANSCRIPTION_NETWORK_ERROR'
  | 'FORMAT_UNSUPPORTED';

export type EvidenceType = 'page' | 'script' | 'video_frame' | 'none';

// ==================== 2. 多源证据结构 ====================

export interface PageEvidence {
  page_no: number;
  ocr_text: string;
  key_entities: string[];
  thumbnail_url?: string;
}

export interface ScriptEvidence {
  page_no: number;
  storyline: string;
  scene_description: string;
  character_dialogue?: string;
}

export interface VideoFrameEvidence {
  start_ms: number;
  end_ms: number;
  detected_objects: string[];
  lighting_or_time_of_day: string;
}

export interface EvidenceSource {
  page_no: number;
  video_start_ms: number;
  video_end_ms: number;
  evidence_type: EvidenceType;
  confidence: number;
  snippet: string;
  source_quote?: string;
  thumbnail_url?: string;
  details?: {
    page?: PageEvidence;
    script?: ScriptEvidence;
    video_frame?: VideoFrameEvidence;
  };
}

// ==================== 3. 耗时度量 ====================

/**
 * 耗时度量。只允许写入"真实测得"的值；没有测量的阶段必须是 null，
 * 严禁填常数冒充（答辩时会被追问真实首音延迟）。
 */
export interface LatencyBreakdown {
  asr_ms: number | null;
  retrieval_ms: number | null;
  llm_first_token_ms: number | null;
  llm_total_ms: number | null;
  tts_first_audio_ms: number | null;
  tts_total_ms: number | null;
  total_roundtrip_ms: number;
}

// ==================== 4. 语音问答契约 ====================

export interface AskQuestionRequest {
  book_id: string;
  run_id: string;
  video_ms: number;
  query_text: string; // 必须是真实用户输入或真实 ASR 转写文本，严禁自动伪造默认问题
  /** 输入方式；A 的 interaction_type 只有 voice/touch，键盘输入靠此字段区分 */
  input_method?: 'speech' | 'keyboard';
  audio_mime?: string;
  stream?: boolean;
}

export interface AskQuestionResponse {
  run_id: string;
  question: string;
  answer: string;
  status: 'success' | 'no_evidence' | 'error';
  confidence: number;
  evidence: EvidenceSource[];
  audio_url?: string | null;
  latency: LatencyBreakdown;
  cache_hit: boolean;
  is_demo_mock?: boolean; // 显式标识是否为本地离线演示数据
  /** 答案来源：外部模型服务 / 基于当前书页的本地抽取式检索 / 演示夹具 */
  answer_source?: 'model_service' | 'local_extractive' | 'demo_fixture';
  /** 是否已成功写入后端 A (POST /api/runs/{run_id}/interactions) */
  persisted?: boolean;
  persist_error?: string;
  error_code?: AsrErrorCode | string;
  error_message?: string;
}

// ==================== 5. 触控识别契约 ====================

export interface TouchPoint {
  norm_x: number;
  norm_y: number;
  video_pixel_x: number;
  video_pixel_y: number;
  video_width: number;
  video_height: number;
}

export interface ViewportInfo {
  container_width: number;
  container_height: number;
  render_width: number;
  render_height: number;
  offset_x: number;
  offset_y: number;
  is_letterbox: boolean;
}

export interface TouchRecognitionRequest {
  book_id: string;
  run_id: string;
  video_ms: number;
  touch_point: TouchPoint;
  viewport_info: ViewportInfo;
}

export interface TouchRecognitionResponse {
  run_id: string;
  video_ms: number;
  status: 'success' | 'uncertain' | 'out_of_bounds' | 'error';
  target_name: string;
  explanation: string;
  confidence: number;
  bounding_box?: [number, number, number, number];
  evidence: EvidenceSource | null;
  latency_ms: number;
  cache_hit: boolean;
  is_demo_mock?: boolean;
  persisted?: boolean;
  persist_error?: string;
  error_message?: string;
}

// ==================== 6. 会话历史记录 ====================

export interface InteractionHistoryItem {
  id: string;
  timestamp: number;
  type: 'voice' | 'touch';
  video_ms: number;
  query?: string;
  audio_url?: string | null;
  response_text: string;
  status: 'success' | 'no_evidence' | 'error';
  evidence?: EvidenceSource[];
  latency_ms: number;
  cache_hit: boolean;
  is_demo_mock?: boolean;
}

// ==================== 7. 通用阅读扩展契约 (严格对齐 A 后端) ====================

export type BookType = 'picture_book' | 'novel' | 'textbook' | 'science' | 'other';

export interface ClassificationOut {
  book_id: string;
  predicted_type: BookType;
  confidence: number;
  reasons: string[];
  confirmed_type: string | null;
  confirmed_by: string | null;
  status: string;
}

export interface BackendNoteOut {
  id: string;
  book_id: string;
  owner_id: string;
  content: {
    title?: string;
    body?: string;
    summary?: string;
    page_no?: number;
    video_ms?: number;
    source_quote?: string;
    [key: string]: any;
  };
  status: 'DRAFT' | 'REVIEWING' | 'PRIVATE' | 'SHARED' | 'REVOKED';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BackendShareOut {
  id: string;
  share_mode: 'invite_only' | 'link';
  shared_user_id: string | null;
  expires_at: string | null;
  status: string;
  token?: string | null;
}

export interface SegmentOut {
  id: string;
  run_id: string;
  page_no: number;
  start_ms: number;
  end_ms: number;
  caption: string;
  source: {
    producer: string;
    model_version?: string;
    [key: string]: any;
  };
}
