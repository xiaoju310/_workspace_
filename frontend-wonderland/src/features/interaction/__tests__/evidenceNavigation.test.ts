import { describe, expect, it } from 'vitest'
import type { Source } from '../../../app/types'
import type { SegmentOut } from '../../../types/interaction'
import { resolveEvidenceTarget, splitEvidenceText } from '../evidenceNavigation'

const pages = [{ server_page_no: 3 }, { server_page_no: 8 }, { server_page_no: 12 }]
const source = (patch: Partial<Source> = {}): Source => ({ page_no: 8, source: 'original_page', start_ms: null, end_ms: null, quote: '小兔子', ...patch })
const segments = [{ page_no: 8, start_ms: 42000, end_ms: 60000 }] as SegmentOut[]

describe('答案依据定位', () => {
  it('非连续服务端页码映射到真实数组位置，不用页码减一', () => {
    expect(resolveEvidenceTarget(source(), pages, segments, 90000)).toMatchObject({ ok: true, pageIndex: 1, pageNo: 8, videoMs: 42000 })
  })
  it.each([0, -1, 1.5, NaN, 99])('拒绝非法或外书页码 %s', page_no => {
    expect(resolveEvidenceTarget(source({ page_no }), pages)).toMatchObject({ ok: false })
  })
  it('原文依据忽略夹带时间，优先用该页可靠时间轴', () => {
    expect(resolveEvidenceTarget(source({ start_ms: 1000 }), pages, segments)).toMatchObject({ videoMs: 42000 })
  })
  it('没有可靠时间轴时只打开原文，不使用均分估算', () => {
    expect(resolveEvidenceTarget(source(), pages, undefined, 90000)).toMatchObject({ ok: true, videoMs: null })
  })
  it('视频引用的0毫秒也是有效位置，未载入时不按占位时长截断', () => {
    expect(resolveEvidenceTarget(source({ source: 'script', start_ms: 0 }), pages)).toMatchObject({ videoMs: 0 })
    expect(resolveEvidenceTarget(source({ source: 'video_frame', start_ms: 80000 }), pages)).toMatchObject({ videoMs: 80000 })
  })
  it.each([-5, NaN, Infinity])('无效时间 %s 使用可靠时间轴兜底', start_ms => {
    expect(resolveEvidenceTarget(source({ source: 'script', start_ms }), pages, segments)).toMatchObject({ videoMs: 42000 })
  })
  it('超出当前视频时长时保留书页而不夹到错误时间点', () => {
    expect(resolveEvidenceTarget(source({ source: 'video_frame', start_ms: 80000 }), pages, segments, 60000)).toMatchObject({ ok: true, videoMs: null, message: expect.stringContaining('超出') })
  })
  it('无服务器页码的本地图书兼容位置页码', () => {
    expect(resolveEvidenceTarget(source({ page_no: 2 }), [{}, {}])).toMatchObject({ ok: true, pageIndex: 1 })
  })
  it('文字逐字匹配才高亮，未命中或空引文不伪造匹配', () => {
    expect(splitEvidenceText('森林里的小兔子跑过来了。', ' 小兔子 ')).toEqual({ before: '森林里的', match: '小兔子', after: '跑过来了。' })
    expect(splitEvidenceText('小兔子', '')).toEqual({ before: '小兔子', match: '', after: '' })
    expect(splitEvidenceText('小兔子', '小熊')).toEqual({ before: '小兔子', match: '', after: '' })
    expect(splitEvidenceText('<script>内容</script>', '<script>')).toEqual({ before: '', match: '<script>', after: '内容</script>' })
  })
})
