import { describe, expect, it } from 'vitest'
import { vocabularyKey, vocabularySource, validateVocabulary, upsertVocabulary } from '../vocabulary'
import type { VocabularyCard } from '../../../app/types'
const card = (patch: Partial<VocabularyCard> = {}): VocabularyCard => ({id:'one', word:'Forest', meaning:'森林', example:'A forest.', source:null, mastered:false, created_at:'today', updated_at:'today', ...patch})
describe('生词卡片数据', () => {
  it('兼容全角、大小写和多余空白的重复词', () => {
    expect(vocabularyKey('  ＦＯＲＥＳＴ ')).toBe('forest')
    expect(vocabularyKey('a   word')).toBe('a word')
    const current = [card()]
    expect(upsertVocabulary(current, card({id:'two', word:' forest '}))).toBe(current)
    expect(current[0].meaning).toBe('森林')
  })
  it('修改同一张卡保留其他卡，新卡追加且不修改输入', () => {
    const current = [card(), card({id:'two', word:'rabbit'})]
    expect(upsertVocabulary(current, card({meaning:'树林'}))[0].meaning).toBe('树林')
    expect(current[0].meaning).toBe('森林')
    expect(upsertVocabulary(current, card({id:'three', word:'river'}))).toHaveLength(3)
  })
  it('编辑为其他已有词不覆盖或删除任一卡', () => {
    const current = [card(), card({id:'two', word:'rabbit'})]
    expect(upsertVocabulary(current, card({word:'rabbit'}))).toBe(current)
  })
  it('空词和超长内容校验，释义允许稍后补充', () => {
    expect(validateVocabulary('  ', '', '')).toContain('生词')
    expect(validateVocabulary('词'.repeat(81), '', '')).toContain('80')
    expect(validateVocabulary('词', '字'.repeat(1001), '')).toContain('1000')
    expect(validateVocabulary('词', '', '字'.repeat(1001))).toContain('1000')
    expect(validateVocabulary('词', '', '')).toBe('')
  })
  it('只有确定原书页才关联来源，未找到词时不伪造引文', () => {
    expect(vocabularySource(null, 'forest', 'forest')).toBeNull()
    expect(vocabularySource(8, '森林里的小兔子', '小兔子')).toMatchObject({page_no:8, quote:'森林里的小兔子', start_ms:null, source:'original_page'})
    expect(vocabularySource(8, '森林', '小兔子')?.quote).toBe('')
  })
})
