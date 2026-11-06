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
}

/** 绘本默认时间轴与多模态数据样本 (6页全书) */
export const DEFAULT_BOOK_SLICES: PictureBookSliceData[] = [
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
  score: number;
  matchedKeywords: string[];
  isTimeWindowMatch: boolean;
}

/**
 * 纸书智伴 · 时间片与多模态证据检索器
 */
export class TimeSliceIndexer {
  private slices: PictureBookSliceData[];

  constructor(slices: PictureBookSliceData[] = DEFAULT_BOOK_SLICES) {
    this.slices = slices;
  }

  /**
   * 根据当前视频时间戳定位所在的页片
   */
  findSliceByVideoMs(videoMs: number): PictureBookSliceData | undefined {
    return this.slices.find((s) => videoMs >= s.video_start_ms && videoMs < s.video_end_ms);
  }

  /**
   * 联合检索：结合当前播放毫秒数 (video_ms) 与文本查询
   * 规则：
   * 1. 优先在当前时间前后 4 秒内检索（时序偏置）；
   * 2. 计算文本在 OCR、分镜、实体、视觉帧列表中的重合度；
   * 3. 过滤明显无关的超纲词汇（如外星人、航天、手机等）。
   */
  searchEvidence(query: string, currentVideoMs: number): EvidenceSource[] {
    const cleanQuery = query.toLowerCase().trim();

    // 负样本关键词直接拦截
    const negativeTokens = ['外星人', '飞船', '宇宙', '航天', '恐龙', '机器人', '汽车'];
    if (negativeTokens.some((token) => cleanQuery.includes(token))) {
      return [];
    }

    const matches: SearchMatchResult[] = [];

    for (const slice of this.slices) {
      let score = 0;
      const matchedKeywords: string[] = [];

      // 1. 时序权重 (当前正在播放这一页，得基础分 0.3)
      const isCurrentTime = currentVideoMs >= slice.video_start_ms && currentVideoMs <= slice.video_end_ms;
      if (isCurrentTime) {
        score += 0.3;
      }

      // 2. 实体匹配
      for (const entity of slice.entities) {
        if (cleanQuery.includes(entity.toLowerCase())) {
          score += 0.4;
          matchedKeywords.push(entity);
        }
      }

      // 3. OCR 文本匹配
      const tokens = ['小狐狸', '妈妈', '红围巾', '大树', '大雁', '啄木鸟', '花', '悬崖', '小溪', '天黑', '回家', '迷路', '采野果'];
      for (const t of tokens) {
        if (cleanQuery.includes(t) && (slice.ocr_content.includes(t) || slice.script.includes(t))) {
          score += 0.25;
          if (!matchedKeywords.includes(t)) matchedKeywords.push(t);
        }
      }

      // 4. 时序词匹配（如天黑了吗）
      if (cleanQuery.includes('天黑') || cleanQuery.includes('晚上') || cleanQuery.includes('太阳')) {
        if (slice.page_no >= 5) score += 0.5;
        if (slice.page_no === 1) score += 0.4;
      }

      // 5. 跨页结尾匹配（如找到妈妈了吗）
      if ((cleanQuery.includes('最后') || cleanQuery.includes('找到') || cleanQuery.includes('结局')) && slice.page_no === 6) {
        score += 0.6;
      }

      if (score >= 0.35 || (isCurrentTime && matchedKeywords.length > 0)) {
        matches.push({
          slice,
          score: Math.min(score, 0.98),
          matchedKeywords,
          isTimeWindowMatch: isCurrentTime,
        });
      }
    }

    // 降序排序
    matches.sort((a, b) => b.score - a.score);

    // 转换为标准 EvidenceSource
    return matches.slice(0, 2).map((m) => {
      const p: PageEvidence = {
        page_no: m.slice.page_no,
        ocr_text: m.slice.ocr_content,
        key_entities: m.slice.entities,
      };
      const s: ScriptEvidence = {
        page_no: m.slice.page_no,
        storyline: m.slice.script,
        scene_description: m.slice.lighting,
      };
      const v: VideoFrameEvidence = {
        start_ms: m.slice.video_start_ms,
        end_ms: m.slice.video_end_ms,
        detected_objects: m.slice.frame_objects,
        lighting_or_time_of_day: m.slice.lighting,
      };

      return {
        page_no: m.slice.page_no,
        video_start_ms: m.slice.video_start_ms,
        video_end_ms: m.slice.video_end_ms,
        evidence_type: 'page',
        confidence: Number(m.score.toFixed(2)),
        snippet: m.slice.snippet,
        source_quote: m.slice.ocr_content,
        details: { page: p, script: s, video_frame: v },
      };
    });
  }
}

export const timeSliceIndexer = new TimeSliceIndexer();
