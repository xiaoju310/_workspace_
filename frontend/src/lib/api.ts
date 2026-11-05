import {
  AskQuestionRequest,
  AskQuestionResponse,
  TouchRecognitionRequest,
  TouchRecognitionResponse,
  ClassificationOut,
  BackendNoteOut,
  BackendShareOut,
  SegmentOut,
  AppMode,
} from '../types/interaction';
import { pictureBookRagEngine } from '../features/interaction/qa/PictureBookRagEngine';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/**
 * 纸书智伴 API 综合客户端
 * 严格对齐后端 A 规范 (docs/api-contract.md) 与队长审查要求：
 * 1. 基础路径为 /api，支持 Bearer 认证；
 * 2. 真实模式 (Live) 下失败抛出真实错误，绝不静默伪造假成功；
 * 3. 演示模式 (Demo) 下显式标注 is_demo_mock: true；
 * 4. 笔记审核与分享完全由服务端驱动。
 */
class ApiClient {
  private base: string;
  private token: string;

  constructor(base: string = API_BASE) {
    this.base = base;
    this.token = typeof localStorage !== 'undefined'
      ? localStorage.getItem('AUTH_BEARER_TOKEN') || 'demo-token-123'
      : 'demo-token-123';
  }

  setToken(token: string) {
    this.token = token;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('AUTH_BEARER_TOKEN', token);
    }
  }

  getToken(): string {
    return this.token;
  }

  private getHeaders(contentType: string = 'application/json'): HeadersInit {
    return {
      'Content-Type': contentType,
      Authorization: `Bearer ${this.token}`,
    };
  }

  // ==================== 1. 问答请求 ====================

  async askQuestion(
    params: AskQuestionRequest,
    mode: AppMode,
    audioBlob?: Blob
  ): Promise<AskQuestionResponse> {
    const startTime = performance.now();

    // 严禁空问题或替用户捏造问题
    if (!params.query_text || !params.query_text.trim()) {
      throw new Error('提问内容为空，请输入问题或对准麦克风清晰提问');
    }

    if (mode === 'live') {
      // 真实模式：必须请求后端
      try {
        let response: Response;
        if (audioBlob) {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'question.wav');
          formData.append('book_id', params.book_id);
          formData.append('run_id', params.run_id);
          formData.append('video_ms', params.video_ms.toString());
          formData.append('query_text', params.query_text);

          response = await fetch(`${this.base}/interaction/qa`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}` },
            body: formData,
            signal: AbortSignal.timeout(4000),
          });
        } else {
          response = await fetch(`${this.base}/interaction/qa`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(4000),
          });
        }

        if (response.ok) {
          const data: AskQuestionResponse = await response.json();
          data.latency.total_roundtrip_ms = Math.round(performance.now() - startTime);
          data.is_demo_mock = false;
          // 异步上报交互记录至后端 A
          this.recordInteractionToBackend(params.run_id, 'voice', { query: params.query_text, video_ms: params.video_ms }, data, data.latency.total_roundtrip_ms);
          return data;
        }

        throw new Error(`后端问答接口返回 HTTP ${response.status}: ${await response.text().catch(() => '')}`);
      } catch (err: any) {
        // 队长要求：真实模式下绝不能静默返回小狐狸故事！
        throw new Error(`【真实联调模式】交互问答请求失败: ${err.message}。如需查看离线原型，请在顶部切换为“演示模式”。`);
      }
    } else {
      // 离线演示模式 (显式标明)
      const mockResp = await pictureBookRagEngine.generateAnswer(params);
      mockResp.latency.total_roundtrip_ms = Math.round(performance.now() - startTime);
      mockResp.is_demo_mock = true;
      return mockResp;
    }
  }

  // ==================== 2. 触控识别请求 ====================

  async recognizeTouch(
    params: TouchRecognitionRequest,
    mode: AppMode
  ): Promise<TouchRecognitionResponse> {
    const startTime = performance.now();

    if (mode === 'live') {
      try {
        const response = await fetch(`${this.base}/interaction/touch`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(3000),
        });

        if (response.ok) {
          const data: TouchRecognitionResponse = await response.json();
          data.latency_ms = Math.round(performance.now() - startTime);
          data.is_demo_mock = false;
          this.recordInteractionToBackend(params.run_id, 'touch', params.touch_point, data, data.latency_ms);
          return data;
        }
        throw new Error(`后端触控识别返回 HTTP ${response.status}`);
      } catch (err: any) {
        // 真实模式下直接报错，严禁捏造实体与证据
        throw new Error(`【真实联调模式】触控识别服务不可用: ${err.message}。若需体验前端黑边过滤与坐标换算，请切换为“演示模式”。`);
      }
    } else {
      // 演示模式 (带显著标识)
      const elapsed = Math.round(performance.now() - startTime) + 120;
      const { norm_x, norm_y } = params.touch_point;
      const isCenter = norm_x > 0.2 && norm_x < 0.8 && norm_y > 0.2 && norm_y < 0.8;

      return {
        run_id: params.run_id,
        video_ms: params.video_ms,
        status: 'success',
        target_name: isCenter ? '演示样本: 画面主体角色' : '演示样本: 背景环境元素',
        explanation: '（⚠️ 此为本地离线演示模式计算出的样例，未连接真实视觉识别模型）',
        confidence: 0.88,
        bounding_box: [Math.max(0, norm_x - 0.1), Math.max(0, norm_y - 0.1), Math.min(1, norm_x + 0.1), Math.min(1, norm_y + 0.1)],
        evidence: {
          page_no: 1,
          video_start_ms: Math.max(0, params.video_ms - 2000),
          video_end_ms: params.video_ms + 2000,
          evidence_type: 'video_frame',
          confidence: 0.88,
          snippet: '离线演示模式下的局部时间窗口样本',
        },
        latency_ms: elapsed,
        cache_hit: false,
        is_demo_mock: true,
      };
    }
  }

  // ==================== 3. 对接后端 A: 上报交互记录 ====================

  async recordInteractionToBackend(
    runId: string,
    type: 'voice' | 'touch',
    input: any,
    output: any,
    latencyMs: number
  ): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/runs/${runId}/interactions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          interaction_type: type,
          input,
          output: {
            ...output,
            producer: 'c_interaction_agent', // A 要求的必填字段
          },
          latency_ms: latencyMs,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ==================== 4. 对接后端 A: 图书分类确认 ====================

  async confirmCategory(bookId: string, confirmedType: string): Promise<ClassificationOut> {
    const res = await fetch(`${this.base}/books/${bookId}/classification`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ confirmed_type: confirmedType }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`分类保存失败: HTTP ${res.status} ${errText}`);
    }

    return await res.json();
  }

  // ==================== 5. 对接后端 A: 动态获取时间轴与成片 ====================

  async getRunSegments(runId: string): Promise<SegmentOut[]> {
    try {
      const res = await fetch(`${this.base}/runs/${runId}/segments`, {
        headers: this.getHeaders(),
      });
      if (res.ok) return await res.json();
    } catch {}
    return [];
  }

  async getRunAssets(runId: string): Promise<any[]> {
    try {
      const res = await fetch(`${this.base}/runs/${runId}/assets`, {
        headers: this.getHeaders(),
      });
      if (res.ok) return await res.json();
    } catch {}
    return [];
  }

  // ==================== 6. 对接后端 A: 笔记与审核分享全生命周期 ====================

  async generateNoteDraft(bookId: string): Promise<BackendNoteOut> {
    const res = await fetch(`${this.base}/books/${bookId}/notes/generate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ note_template: 'standard' }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`生成笔记草稿失败 (HTTP ${res.status}): ${err}`);
    }
    return await res.json();
  }

  async getNote(noteId: string): Promise<BackendNoteOut> {
    const res = await fetch(`${this.base}/notes/${noteId}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`获取笔记失败: HTTP ${res.status}`);
    return await res.json();
  }

  async updateNote(noteId: string, content: any): Promise<BackendNoteOut> {
    const res = await fetch(`${this.base}/notes/${noteId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`更新笔记失败: HTTP ${res.status}`);
    return await res.json();
  }

  async reviewNote(noteId: string, action: 'approve' | 'revise'): Promise<BackendNoteOut> {
    const res = await fetch(`${this.base}/notes/${noteId}/review`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`审核操作失败 (HTTP ${res.status}): ${err}`);
    }
    return await res.json();
  }

  async createNoteShare(noteId: string, shareMode: 'link' | 'invite_only' = 'link'): Promise<BackendShareOut> {
    const res = await fetch(`${this.base}/notes/${noteId}/shares`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ share_mode: shareMode }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`创建分享失败 (HTTP ${res.status}): ${err}`);
    }
    return await res.json();
  }

  async revokeNoteShare(noteId: string, shareId: string): Promise<void> {
    const res = await fetch(`${this.base}/notes/${noteId}/shares/${shareId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`撤销分享失败: HTTP ${res.status}`);
    }
  }
}

export const apiClient = new ApiClient();
