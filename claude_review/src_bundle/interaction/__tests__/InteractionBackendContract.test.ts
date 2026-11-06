import { describe, it, expect } from 'vitest';

describe('交互记录上报与后端契约规范校验', () => {
  it('验证交互记录必须携带 producer: c_interaction_agent 与非负延迟', () => {
    function buildBackendInteractionPayload(
      type: 'voice' | 'touch',
      input: Record<string, any>,
      output: Record<string, any>,
      latencyMs: number
    ) {
      if (!['voice', 'touch'].includes(type)) {
        throw new Error('交互类型无效');
      }
      if (latencyMs < 0) {
        throw new Error('延迟不能小于0');
      }
      if (!output || typeof output !== 'object') {
        throw new Error('output 必须为对象');
      }

      return {
        interaction_type: type,
        input,
        output: {
          ...output,
          producer: 'c_interaction_agent',
        },
        latency_ms: latencyMs,
      };
    }

    const payload = buildBackendInteractionPayload(
      'voice',
      { query: '测试提问', video_ms: 1200 },
      { answer: '测试回答', evidence: [] },
      150
    );

    expect(payload.interaction_type).toBe('voice');
    expect(payload.output.producer).toBe('c_interaction_agent');
    expect(payload.latency_ms).toBe(150);

    // 负延迟拦截
    expect(() =>
      buildBackendInteractionPayload('voice', {}, {}, -1)
    ).toThrow('延迟不能小于0');

    // 错误类型拦截
    expect(() =>
      buildBackendInteractionPayload('invalid' as any, {}, {}, 10)
    ).toThrow('交互类型无效');
  });

  it('验证笔记全生命周期状态机转移合法性', () => {
    const validTransitions: Record<string, string[]> = {
      draft: ['in_review'],
      in_review: ['approved', 'rejected'],
      approved: ['shared', 'draft'],
      rejected: ['draft'],
      shared: ['private'],
    };

    function canTransition(current: string, next: string): boolean {
      return validTransitions[current]?.includes(next) ?? false;
    }

    expect(canTransition('draft', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'approved')).toBe(true);
    expect(canTransition('approved', 'shared')).toBe(true);
    // 草稿禁止直接分享（必须先经主人审核批准）
    expect(canTransition('draft', 'shared')).toBe(false);
  });
});
