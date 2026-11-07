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
/**
 * 儿童危险提问识别（E-019 加固）。
 * 旧版 `从.*跳` 会把"小兔子从草地上跳过去了吗"误判为危险；同时漏掉插座、陌生人、爬窗、下河等常见危险。
 * 规则只看提问里的"危险对象 + 危险动作"组合，跨度限制在几个字以内，避免整句贪婪匹配。
 */
const SAFETY_RULES: RegExp[] = [
  /(悬崖|楼上|楼顶|屋顶|阳台|窗户|窗台|高处|桥上|树上|山上).{0,6}跳/,
  /跳(下去|下来|楼|崖|河|井|海)/,
  /(玩|点|放|碰)(火|打火机|火柴|鞭炮)|着火.{0,4}(玩|摸|靠近)/,
  /(玩|拿|用|戳).{0,3}(刀|剪刀|针)|(刀|剪刀).{0,3}(玩|戳|扎)/,
  /触电|(摸|碰|插|抠).{0,3}(插座|电线|电源|插头)/,
  /(吃|喝|尝|吞).{0,4}(药|不认识|不明|洗衣|清洁剂|消毒|电池|硬币|蘑菇)/,
  /(药|药片|洗衣液|清洁剂|消毒液|电池|硬币|野蘑菇).{0,6}(吃|喝|吞)/, // 宾语前置："药可以随便吃吗"
  /(跟|和).{0,2}陌生人.{0,4}(走|去|回家)|陌生人.{0,4}(给|带)/,
  /一个人.{0,4}(出去|跑远|下河|下水|游泳|去河边|去湖边|过马路)/,
  /(爬|翻).{0,3}(窗|阳台|栏杆|围墙)/,
  /马路(上|中间).{0,4}(玩|跑|追)/,
];
export function isDangerousQuestion(query: string): boolean {
  return SAFETY_RULES.some((r) => r.test(query));
}
const SAFETY_NOTE = '这样做很危险，请不要模仿，遇到这类情况要先告诉大人。';

function clip(text: string, max = 80): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

const MAX_CACHE = 200;

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

  private remember(key: string, item: CachedItem): void {
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, item);
  }

  async generateAnswer(req: AskQuestionRequest, indexer: TimeSliceIndexer): Promise<AskQuestionResponse> {
    const t0 = performance.now();
    const query = (req.query_text || '').trim();
    // 答案取决于：哪本书、哪次运行、索引内容、当前播放落在哪一页（时序加权）、问题本身
    const inPage = indexer.findSliceByVideoMs(req.video_ms)?.page_no ?? 0;
    const cacheKey = [req.book_id, req.run_id, indexer.fingerprint(), inPage, query.toLowerCase()].join('|');

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return {
        run_id: req.run_id,
        question: query,
        answer: cached.answer,
        status: cached.status,
        confidence: cached.confidence,
        evidence: cached.evidence.map((e) => ({ ...e })),
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
      const base_text = indexer.size() === 0
        ? '当前这本书还没有经过校对的文字内容，无法回答。请先完成逐页文字校对。'
        : '原书这段内容里没有找到相关依据，请结合书页观察，或换个问法。';
      // 安全提示不依赖证据：危险提问找不到依据时更需要提醒
      const noAnswer = isDangerousQuestion(query) ? `${SAFETY_NOTE} ${base_text}` : base_text;
      this.remember(cacheKey, { answer: noAnswer, status: 'no_evidence', confidence: 0, evidence: [] });
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
    const safety = isDangerousQuestion(query) ? SAFETY_NOTE : '';
    const answer = `${safety}${safety ? ' ' : ''}原书第 ${top.page_no} 页写道：“${clip(quote)}”`;

    this.remember(cacheKey, { answer, status: 'success', confidence: top.confidence, evidence: evidence.map((e) => ({ ...e })) });

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
