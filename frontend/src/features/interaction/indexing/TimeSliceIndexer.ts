import { EvidenceSource, PageEvidence, ScriptEvidence, VideoFrameEvidence } from '../../../types/interaction';

export interface PictureBookSliceData {
  page_no: number;
  video_start_ms: number;
  video_end_ms: number;
  ocr_content: string;
  entities: string[];
  script: string;
  frame_objects: string[];
  lighting: string;
  snippet: string;
  /** 是否为全书第一页/最后一页（由 buildSlicesFromBook 按全书位置标注；未标注时按索引数组首尾判断） */
  is_first_page?: boolean;
  is_last_page?: boolean;
}

/**
 * 【仅限 Demo 夹具】小狐狸样例书的时间轴与多模态数据。
 * Live 模式严禁使用；Live 的索引必须由 buildSlicesFromBook(当前图书) 构建。
 */
export const DEMO_BOOK_SLICES: PictureBookSliceData[] = [
  {
    page_no: 1,
    video_start_ms: 0,
    video_end_ms: 8000,
    ocr_content: '从前有一只活泼的小狐狸皮皮，每天清晨戴着红围巾在森林里唱歌。',
    entities: ['小狐狸', '皮皮', '红围巾', '森林', '清晨', '草地', '粉红色小花'],
    script: '清晨阳光穿透树梢，小狐狸系好红围巾，背着小挎包轻快地走出树洞。',
    frame_objects: ['小狐狸', '红色围巾', '参天大树', '3朵粉色小花', '太阳'],
    lighting: '早晨柔和金光',
    snippet: '第 1 页：戴红围巾的小狐狸皮皮走出树洞',
  },
  {
    page_no: 2,
    video_start_ms: 8000,
    video_end_ms: 18000,
    ocr_content: '为了给生病的狐狸妈妈采摘甜甜的红浆果，皮皮越走越远，迷路在密林中。',
    entities: ['狐狸妈妈', '红浆果', '迷路', '密林', '荆棘'],
    script: '小狐狸专注地采摘树丛深处的红浆果，抬头发现四面都是陌生的巨树，迷路了。',
    frame_objects: ['小狐狸', '红浆果树丛', '迷雾', '荆棘'],
    lighting: '林荫斑驳，光线略显幽暗',
    snippet: '第 2 页：小狐狸为妈妈采野浆果，不小心迷了路',
  },
  {
    page_no: 3,
    video_start_ms: 18000,
    video_end_ms: 27000,
    ocr_content: '天空飞过一只美丽的大雁，羽毛是湛蓝色的，嘴巴金黄。',
    entities: ['大雁', '天空', '蓝色羽毛', '金黄色尖喙', '飞翔'],
    script: '小狐狸仰望天空呼喊，一只大雁展翅划过晴空，鸣叫着指向南方。',
    frame_objects: ['小狐狸', '天空', '蓝色大雁', '白云'],
    lighting: '晴朗蓝天',
    snippet: '第 3 页：蓝色羽毛、金黄嘴巴的大雁在天空中指路',
  },
  {
    page_no: 4,
    video_start_ms: 27000,
    video_end_ms: 36000,
    ocr_content: '来到悬崖峭壁边，啄木鸟医生从树干探出头说：孩子别害怕，沿着小溪走！',
    entities: ['悬崖', '峭壁', '啄木鸟', '小溪', '安全', '树干'],
    script: '小狐狸站在高高的石壁前犹豫，啄木鸟挥舞翅膀叮嘱它不要靠近悬崖，顺小溪前进。',
    frame_objects: ['小狐狸', '高悬崖', '小溪', '啄木鸟医生'],
    lighting: '午后明亮阳光',
    snippet: '第 4 页：啄木鸟医生指引小溪方向，提醒远离危险悬崖',
  },
  {
    page_no: 5,
    video_start_ms: 36000,
    video_end_ms: 46000,
    ocr_content: '黄昏降临，夕阳把森林染成橙红色，小溪边传来了妈妈焦急呼唤的声音。',
    entities: ['黄昏', '夕阳', '橙红色', '晚霞', '妈妈的呼唤'],
    script: '太阳缓缓落山，晚霞如火，小狐狸顺着水流奔跑，听到了熟悉的呼唤声。',
    frame_objects: ['小狐狸', '橙红晚霞', '溪流波光', '归鸟'],
    lighting: '黄昏橙红色落日',
    snippet: '第 5 页：夕阳西下，天色渐晚，小狐狸听到妈妈的呼声',
  },
  {
    page_no: 6,
    video_start_ms: 46000,
    video_end_ms: 55000,
    ocr_content: '小狐狸终于回到了温暖的小屋，紧紧拥抱了妈妈，一家人开心地吃起浆果。',
    entities: ['回家', '温暖树洞小屋', '妈妈', '拥抱', '团聚', '甜浆果'],
    script: '狐狸妈妈紧紧搂住皮皮，热茶升起白雾，全家人平安团聚，故事画上圆满句号。',
    frame_objects: ['小狐狸', '狐狸妈妈', '树洞家', '热茶', '果盘'],
    lighting: '暖黄色室内烛光',
    snippet: '第 6 页：小狐狸平安到家，与妈妈拥抱团聚',
  },
];

export interface SearchMatchResult {
  slice: PictureBookSliceData;
  coverage: number;
  matchedTerms: string[];
}

/**
 * 切词规则（E-020 根因修复）。
 *
 * 旧实现把"地/过/着/对/向/得/给/能/会/里/一/可/以…"当成单字停用字：它们在提问里常是功能字，
 * 但在故事里更常是实词的一部分（草地、过河、着火、对面、向日葵、得到、一起、可爱）。
 * 上一轮只把"到"移出名单修好了"捡到"，同类缺陷全部还在——"草地上有几朵花"里的"草地"会被切碎。
 *
 * 现在：先整体删除多字疑问/功能短语，再只删除真正不承载内容的单字（语气词、代词、标点）。
 * 宁可多留几个二元组（由 MIN_COVERAGE 与区分性约束兜底），也不能把实词切坏。
 */
const STOP_PHRASES = [
  '为什么', '是不是', '有没有', '能不能', '会不会', '可不可以', '怎么样', '什么样', '告诉我',
  '什么', '怎么', '怎样', '哪里', '哪儿', '哪个', '哪些', '多少', '请问', '可以', '知道', '一下',
];
const STOP_CHARS = new Set('的了吗呢吧啊呀么嘛哦哇呗你我他她它们这那谁几是有和与或及？?，,。.！!、；;：:"“”‘’（）()…—~～ '.split(''));

/** 时序意图词（与具体故事无关）：结局 → 最后一页；开头 → 第一页 */
const ENDING_WORDS = ['最后', '结局', '最终', '结尾', '后来怎么样'];
const BEGINNING_WORDS = ['一开始', '开头', '最初', '起初', '故事开始'];

/** 把文本切成"去功能短语/功能字后的连续片段 → 字符二元组" */
export function contentBigrams(text: string): string[] {
  let t = text.toLowerCase();
  for (const phrase of STOP_PHRASES) t = t.split(phrase).join(' ');
  const runs: string[] = [];
  let cur = '';
  for (const ch of t) {
    if (STOP_CHARS.has(ch) || /\s/.test(ch)) {
      if (cur) runs.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) runs.push(cur);
  const out: string[] = [];
  for (const run of runs) {
    if (run.length === 1) continue; // 单字噪声大，忽略
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return Array.from(new Set(out));
}

function sliceText(s: PictureBookSliceData): string {
  return [s.ocr_content, s.script, s.entities.join(' '), s.frame_objects.join(' '), s.snippet].join(' ');
}

/**
 * 纸书智伴 · 时间片与多模态证据检索器（抽取式，无任何故事专用词表）
 *
 * 判定规则（防幻觉的核心）：
 *  - 覆盖率 coverage = 命中的提问二元组数 / 提问二元组总数；
 *  - 必须至少命中一个"区分性"二元组（只出现在不超过一半页面里），
 *    只命中"小狐狸"这种全书都有的词不算证据；
 *  - 覆盖率 < MIN_COVERAGE 一律视为无证据 → 返回空数组，由上层拒答。
 * 时序信息只用来在相近得分时打破平局，不能单独制造证据。
 */
export class TimeSliceIndexer {
  static readonly MIN_COVERAGE = 0.4;
  private slices: PictureBookSliceData[];

  constructor(slices: PictureBookSliceData[] = []) {
    this.slices = slices;
  }

  size(): number {
    return this.slices.length;
  }

  /** 索引内容指纹：书页文字或时间轴一变就变，供答案缓存判断是否失效 */
  fingerprint(): string {
    let h = 2166136261;
    for (const ch of JSON.stringify(this.slices)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return `${this.slices.length}:${(h >>> 0).toString(16)}`;
  }

  findSliceByVideoMs(videoMs: number): PictureBookSliceData | undefined {
    return this.slices.find((s) => s.video_start_ms >= 0 && videoMs >= s.video_start_ms && videoMs < s.video_end_ms);
  }

  searchEvidence(query: string, currentVideoMs: number): EvidenceSource[] {
    const grams = contentBigrams(query);
    if (grams.length === 0 || this.slices.length === 0) return [];

    const texts = this.slices.map(sliceText);
    const df = new Map<string, number>();
    for (const g of grams) df.set(g, texts.filter((t) => t.toLowerCase().includes(g)).length);
    const half = Math.ceil(this.slices.length / 2);

    const wantsEnding = ENDING_WORDS.some((w) => query.includes(w));
    const wantsBeginning = BEGINNING_WORDS.some((w) => query.includes(w));
    const lastIdx = this.slices.length - 1;

    const matches: (SearchMatchResult & { rank: number; discriminative: boolean })[] = [];
    this.slices.forEach((slice, idx) => {
      const lower = texts[idx].toLowerCase();
      const matched = grams.filter((g) => lower.includes(g));
      let coverage = matched.length / grams.length;
      let discriminative = matched.some((g) => (df.get(g) ?? 0) <= half && (df.get(g) ?? 0) > 0);
      if ((wantsEnding && idx === lastIdx) || (wantsBeginning && idx === 0)) {
        coverage = Math.min(1, coverage + 0.3);
        discriminative = true;
      }
      if (coverage < TimeSliceIndexer.MIN_COVERAGE || !discriminative) return;
      const inWindow =
        slice.video_start_ms >= 0 && currentVideoMs >= slice.video_start_ms && currentVideoMs <= slice.video_end_ms;
      matches.push({ slice, coverage, matchedTerms: matched, rank: coverage + (inWindow ? 0.05 : 0), discriminative });
    });

    // E-030 位置意图兜底：「故事开头讲了什么」「结局是怎样的」这类问题与原文没有字面重叠，旧规则一律拒答。
    // 只在【没有任何内容命中】且问题只指向一端时，才用全书第一页/最后一页的原文作为页级依据；
    // 若那一页没有校对（不在索引里），宁可拒答，不拿别的页冒充开头/结尾。
    if (matches.length === 0 && wantsBeginning !== wantsEnding && this.slices.length >= 2) {
      const flagged = this.slices.some((s) => s.is_first_page !== undefined || s.is_last_page !== undefined);
      const target = wantsBeginning
        ? flagged ? this.slices.find((s) => s.is_first_page) : this.slices[0]
        : flagged ? this.slices.find((s) => s.is_last_page) : this.slices[lastIdx];
      if (target) {
        matches.push({
          slice: target,
          coverage: TimeSliceIndexer.MIN_COVERAGE,
          matchedTerms: [wantsBeginning ? '<位置意图:开头>' : '<位置意图:结尾>'],
          rank: TimeSliceIndexer.MIN_COVERAGE,
          discriminative: true,
        });
      }
    }

    matches.sort((a, b) => b.rank - a.rank);

    return matches.slice(0, 2).map((m) => {
      const hasTimeline = m.slice.video_start_ms >= 0 && m.slice.video_end_ms > m.slice.video_start_ms;
      const p: PageEvidence = { page_no: m.slice.page_no, ocr_text: m.slice.ocr_content, key_entities: m.slice.entities };
      const s: ScriptEvidence = { page_no: m.slice.page_no, storyline: m.slice.script, scene_description: m.slice.lighting };
      const v: VideoFrameEvidence = {
        start_ms: m.slice.video_start_ms,
        end_ms: m.slice.video_end_ms,
        detected_objects: m.slice.frame_objects,
        lighting_or_time_of_day: m.slice.lighting,
      };
      return {
        page_no: m.slice.page_no,
        // 没有时间轴的页：用 0/0 占位并以 evidence_type='page' 表示"仅页级证据"，调用方不得当作视频时间
        video_start_ms: hasTimeline ? m.slice.video_start_ms : 0,
        video_end_ms: hasTimeline ? m.slice.video_end_ms : 0,
        evidence_type: hasTimeline ? 'video_frame' : 'page',
        // 检索覆盖率，不是模型置信度
        confidence: Number(Math.min(0.98, 0.35 + 0.6 * m.coverage).toFixed(2)),
        snippet: m.slice.snippet,
        source_quote: m.slice.ocr_content,
        details: { page: p, script: s, video_frame: hasTimeline ? v : undefined },
      } as EvidenceSource;
    });
  }
}

/** Demo 专用单例（小狐狸夹具）。Live 路径不得引用。 */
export const demoTimeSliceIndexer = new TimeSliceIndexer(DEMO_BOOK_SLICES);
