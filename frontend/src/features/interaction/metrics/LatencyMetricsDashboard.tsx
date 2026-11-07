import React from 'react';
import type { Interaction } from '../../../app/types';

/**
 * 交互延迟与样本看板（整改版，见 error-ledger E-022）。
 *
 * 旧版问题：App 传入的 history 永远是 []，于是看板永远显示兜底常数——语音 320ms、触控 190ms、
 * 准确率 100%、"门槛状态：已达标"，以及写死的"ASR 120ms / 检索 65ms / 短答 110ms / TTS 140ms"。
 * 这些数字没有任何一次测量来源。
 *
 * 现在的规则：
 *  1. 只统计当前会话里真实发生的交互记录（由调用方传入）；没有数据就显示"暂无实测数据"；
 *  2. 真实接口(origin=real)与演示(origin=mock)分开统计，演示数据明确标注"演示数据"；
 *  3. 延迟只对实测过(latency_ms 非 null)的样本求平均，并给出样本数；
 *  4. 不叫"准确率"：没有人工标准答案就无法判断对错，这里只统计"有依据回答 x/n"；
 *  5. 触控未接入视觉模型时显示"未完成真实识别"，不计入任何通过率；
 *  6. 不再出现"赛题达标/已达标"，标题明确为"当前样本结果"。
 */

export interface SampleStats {
  total: number;
  measured: number;
  avgLatencyMs: number | null;
  withEvidence: number;
  cacheHits: number;
  notPersisted: number;
}

export interface OriginStats {
  voice: SampleStats;
  touch: SampleStats & { recognized: number; unrecognized: number };
}

function stats(items: Interaction[]): SampleStats {
  const measured = items.filter((i) => typeof i.latency_ms === 'number' && Number.isFinite(i.latency_ms));
  return {
    total: items.length,
    measured: measured.length,
    avgLatencyMs: measured.length ? Math.round(measured.reduce((s, i) => s + (i.latency_ms as number), 0) / measured.length) : null,
    withEvidence: items.filter((i) => !i.uncertain && i.sources.length > 0).length,
    cacheHits: items.filter((i) => i.cached).length,
    notPersisted: items.filter((i) => i.persisted === false).length,
  };
}

/** 纯函数，供单测直接调用 */
export function summarizeInteractions(items: Interaction[], origin: Interaction['origin']): OriginStats {
  const mine = items.filter((i) => i.origin === origin);
  const touches = mine.filter((i) => i.kind === 'touch');
  const recognized = touches.filter((i) => i.recognized === true).length;
  return {
    voice: stats(mine.filter((i) => i.kind === 'question')),
    touch: { ...stats(touches), recognized, unrecognized: touches.length - recognized },
  };
}

const card: React.CSSProperties = { padding: '10px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' };
const label: React.CSSProperties = { fontSize: '11px', color: '#64748b' };
const big: React.CSSProperties = { fontSize: '18px', fontWeight: 'bold' };
const small: React.CSSProperties = { fontSize: '10px', color: '#94a3b8' };

function latencyText(s: SampleStats) {
  return s.avgLatencyMs === null ? '暂无实测数据' : `${s.avgLatencyMs} ms`;
}

const Section: React.FC<{ title: string; tone: 'real' | 'mock'; s: OriginStats }> = ({ title, tone, s }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{title}</strong>
      <span
        style={{
          fontSize: '10px',
          padding: '1px 6px',
          borderRadius: '8px',
          backgroundColor: tone === 'real' ? '#e0f2fe' : '#fef3c7',
          color: tone === 'real' ? '#075985' : '#92400e',
        }}
      >
        {tone === 'real' ? '真实接口记录' : '演示数据（不代表实测）'}
      </span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
      <div style={card}>
        <div style={label}>语音/文字问答平均请求延迟</div>
        <div style={{ ...big, color: '#2563eb' }}>{latencyText(s.voice)}</div>
        <div style={small}>
          实测样本 {s.voice.measured}/{s.voice.total} · 仅含问答请求，不含 ASR/TTS
        </div>
      </div>
      <div style={card}>
        <div style={label}>问答有依据回答</div>
        <div style={{ ...big, color: '#16a34a' }}>{s.voice.total ? `${s.voice.withEvidence}/${s.voice.total}` : '暂无样本'}</div>
        <div style={small}>不是准确率：尚无人工标准答案比对 · 缓存命中 {s.voice.cacheHits}</div>
      </div>
      <div style={card}>
        <div style={label}>触控请求平均延迟</div>
        <div style={{ ...big, color: '#059669' }}>{latencyText(s.touch)}</div>
        <div style={small}>实测样本 {s.touch.measured}/{s.touch.total}</div>
      </div>
      <div style={card}>
        <div style={label}>触控真实识别</div>
        <div style={{ ...big, color: s.touch.recognized ? '#059669' : '#b45309' }}>
          {s.touch.total === 0 ? '暂无样本' : s.touch.recognized === 0 ? '未完成真实识别' : `${s.touch.recognized}/${s.touch.total}`}
        </div>
        <div style={small}>未识别 {s.touch.unrecognized} 条（视觉模型未接入时只记录坐标），不计入通过率</div>
      </div>
    </div>
    {(s.voice.notPersisted > 0 || s.touch.notPersisted > 0) && (
      <div role="alert" style={{ fontSize: '11px', color: '#b91c1c' }}>
        有 {s.voice.notPersisted + s.touch.notPersisted} 条记录未写入后端，不能作为留痕证据。
      </div>
    )}
  </div>
);

interface LatencyMetricsDashboardProps {
  interactions: Interaction[];
  /** 数据来源说明（例如"当前浏览器会话 · Live 模式"），必须如实填写 */
  sourceLabel: string;
  /** 读取记录失败的原因；有值时必须显示，不能当作"暂无数据" */
  loadError?: string | null;
}

export const LatencyMetricsDashboard: React.FC<LatencyMetricsDashboardProps> = ({ interactions, sourceLabel, loadError }) => {
  const real = summarizeInteractions(interactions, 'real');
  const mock = summarizeInteractions(interactions, 'mock');
  const hasReal = real.voice.total + real.touch.total > 0;
  const hasMock = mock.voice.total + mock.touch.total > 0;

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a' }}>📊 交互延迟看板 · 当前样本结果</h3>
        <span style={{ fontSize: '11px', backgroundColor: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '10px' }}>
          未经正式测试，不是赛题验收结论
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#64748b' }}>数据来源：{sourceLabel}</div>

      {loadError && (
        <div role="alert" style={{ fontSize: '12px', color: '#b91c1c' }}>
          交互记录读取失败：{loadError}（下方统计不完整）
        </div>
      )}
      {!hasReal && !hasMock && !loadError && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: '13px' }}>
          暂无实测数据。请先在工作台里提问或点击画面，再回到这里查看。
        </div>
      )}
      {hasReal && <Section title="真实接口样本" tone="real" s={real} />}
      {hasMock && <Section title="演示样本" tone="mock" s={mock} />}

      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
        分阶段耗时（ASR / 检索 / 生成 / TTS 首音）当前未逐条采集，因此不显示分解；接入真实 ASR/TTS 并记录后再展示。
      </div>
    </div>
  );
};
