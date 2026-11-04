/**
 * 纸书智伴 - 交互模块全量类型定义 (TypeScript)
 * 对应第一周 (D1~D7 半程闭环) 与两周交付标准
 */

// ==================== 1. 基础状态与错误码 ====================

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

// ==================== 2. 多源证据结构 (D3~D5 核心) ====================

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

/** 统一的结构化证据对象 */
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

// ==================== 3. 交互耗时度量 (Latency Metrics) ====================

export interface LatencyBreakdown {
  asr_ms: number;             // ASR 转写耗时
  retrieval_ms: number;       // 时间片与页码证据检索耗时
  llm_first_token_ms: number; // LLM 首字延迟
  llm_total_ms: number;       // LLM 完整短答生成耗时
  tts_first_audio_ms: number; // TTS 首音频包到达耗时
  tts_total_ms: number;       // TTS 完整合成耗时
  total_roundtrip_ms: number; // 客户端端到端耗时
}

// ==================== 4. 语音问答契约 (QA Contract) ====================

export interface AskQuestionRequest {
  book_id: string;
  run_id: string;
  video_ms: number;
  query_text?: string;
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
  error_code?: AsrErrorCode | string;
  error_message?: string;
}

// ==================== 5. 触控识别契约 (Touch Contract) ====================

export interface TouchPoint {
  norm_x: number;
  norm_y: number;
  video_pixel_x: number;
  video_pixel_y: number;
  video_width: number;
  video_height: number;
}

export interface TouchRecognitionRequest {
  book_id: string;
  run_id: string;
  video_ms: number;
  touch_point: TouchPoint;
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

export interface TouchRecognitionResponse {
  run_id: string;
  video_ms: number;
  status: 'success' | 'uncertain' | 'out_of_bounds' | 'error';
  target_name: string;
  explanation: string;
  confidence: number;
  bounding_box?: [number, number, number, number];
  evidence: EvidenceSource;
  latency_ms: number;
  cache_hit: boolean;
  error_message?: string;
}

// ==================== 6. 会话历史记录 (D7 半程验收核心) ====================

export interface InteractionHistoryItem {
  id: string;
  timestamp: number;
  type: 'qa' | 'touch';
  video_ms: number;
  query?: string;
  audio_url?: string | null;
  response_text: string;
  status: 'success' | 'no_evidence' | 'error';
  evidence?: EvidenceSource[];
  latency_ms: number;
  cache_hit: boolean;
}

// ==================== 7. 通用阅读扩展契约 ====================

export type BookCategory =
  | 'picture_book'
  | 'textbook'
  | 'literature'
  | 'science'
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
