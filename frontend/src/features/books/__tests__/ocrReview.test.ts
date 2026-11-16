import { describe, expect, it } from 'vitest'
import { findSuspectOcrLines, ocrReferenceScore } from '../ocrReview'

describe('OCR 保守校对辅助', () => {
  it('标记实测出现的装饰与拉丁杂字符，并保留原行号', () => {
    const text = '龟兔赛跑\r\n●\r\nà\r\n小乌龟和小兔子，\r\nII'
    expect(findSuspectOcrLines(text)).toEqual([{ line: 2, text: '●' }, { line: 3, text: 'à' }, { line: 5, text: 'II' }])
    expect(text).toContain('●\r\nà')
  })
  it('不把普通短行、页码、英文和标点统一当作杂字', () => {
    expect(findSuspectOcrLines('一\n人\n3\nA\nI\nChapter II\n你好！\n“')).toEqual([])
  })
  it('空行不提示，重复字符仍按行号分别列出', () => {
    expect(findSuspectOcrLines(' \n●\n●')).toEqual([{ line: 2, text: '●' }, { line: 3, text: '●' }])
  })
  it.each([null, undefined, NaN, Infinity, -0.1, 1.1])('无效分数 %s 不伪装成准确率', score => {
    expect(ocrReferenceScore(score)).toBe('暂未提供')
  })
  it('参考分用分值而不是百分比表示', () => {
    expect(ocrReferenceScore(.97133)).toBe('97 / 100')
    expect(ocrReferenceScore(0)).toBe('0 / 100')
    expect(ocrReferenceScore(1)).toBe('100 / 100')
  })
})
