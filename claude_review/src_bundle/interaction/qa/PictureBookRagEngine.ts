import type { AskQuestionRequest, AskQuestionResponse, EvidenceSource } from '../../../types/interaction';
import { TimeSliceIndexer } from '../indexing/TimeSliceIndexer';

/**
 * 纸书智伴 · 抽取式证据短答引擎（无故事专用模板）
 *
 * - 答案只能是证据原文的节选，不生成、不推断、不使用任何预设故事答案；
 * - 无证据 → status='no_evidence'，如实拒答；
 * - 通用儿童安全提示基于提问本身的危险动作词，与具体故事无关；
 * - 耗时只记录真实测得值，未测量的阶段一律 null。
 */
const SAFETY_PATTERNS = /(跳下|跳崖|从.*跳|玩火|点火|刀|剪刀.*(玩|戳)|触电|吃.*不明|一个人.*(出去|跑远)|喝.*药)/;
const SAFETY_NOTE = '这样做很危险，请不要模仿，遇到这类情况要先告诉大人。';

function clip(text: string, max = 80): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

interface CachedItem {
  answer: string;
  status: AskQuestionResponse['status'];
  confidence: number;
  evidence: EvidenceSource[];
}

export class PictureBookRagEngine {
  private cache = new Map<string, CachedItem>();

  clearCache(): void {
    this.cache.clear();
  }

  async generateAnswer(req: AskQuestionRequest, indexer: TimeSliceIndexer): Promise<AskQuestionResponse> {
    const t0 = performance.now();
    const query = (req.query_text || '').trim();
    const cacheKey = `${req.run_id}:${query.toLowerCase()}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return {
        run_id: req.run_id,
        question: query,
        answer: cached.answer,
        status: cached.status,
        confidence: cached.confidence,
        evidence: cached.evidence,
        audio_url: null,
        cache_hit: true,
        latency: {
          asr_ms: null,
          retrieval_ms: 0,
          llm_first_token_ms: null,
          llm_total_ms: null,
          tts_first_audio_ms: null,
          tts_total_ms: null,
          total_roundtrip_ms: Math.round(performance.now() - t0),
        },
      };
    }

    const r0 = performance.now();
    const evidence: EvidenceSource[] = indexer.searchEvidence(query, req.video_ms);
    const retrievalMs = Math.round(performance.now() - r0);

    const base = {
      run_id: req.run_id,
      question: query,
      cache_hit: false,
    };
    const latency = (): AskQuestionResponse['latency'] => ({
      asr_ms: null,
      retrieval_ms: retrievalMs,
      llm_first_token_ms: null,
      llm_total_ms: null,
      tts_first_audio_ms: null,
      tts_total_ms: null,
      total_roundtrip_ms: Math.round(performance.now() - t0),
    });

    if (evidence.length === 0) {
      const noAnswer = indexer.size() === 0
        ? '当前这本书还没有经过校对的文字内容，无法回答。请先完成逐页文字校对。'
        : '原书这段内容里没有找到相关依据，请结合书页观察，或换个问法。';
      this.cache.set(cacheKey, { answer: noAnswer, status: 'no_evidence', confidence: 0, evidence: [] });
      return {
        ...base,
        answer: noAnswer,
        status: 'no_evidence',
        confidence: 0,
        evidence: [],
        latency: latency(),
      };
    }

    const top = evidence[0];
    const quote = top.source_quote || top.snippet;
    const safety = SAFETY_PATTERNS.test(query) ? SAFETY_NOTE : '';
    const answer = `${safety}${safety ? ' ' : ''}原书第 ${top.page_no} 页写道：“${clip(quote)}”`;

    this.cache.set(cacheKey, { answer, status: 'success', confidence: top.confidence, evidence });

    return {
      ...base,
      answer,
      status: 'success',
      confidence: top.confidence,
      evidence,
      audio_url: null,
      latency: latency(),
    };
  }
}

export const pictureBookRagEngine = new PictureBookRagEngine();
