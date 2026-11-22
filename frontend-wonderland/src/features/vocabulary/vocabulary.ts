import type { Source, VocabularyCard } from '../../app/types'

export const vocabularyKey = (word: string) => word.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
export function validateVocabulary(word: string, meaning: string, example: string) {
  if (!word.trim()) return '请先填写生词。'
  if (word.trim().length > 80) return '生词请控制在80个字以内。'
  if (meaning.trim().length > 1000 || example.trim().length > 1000) return '释义和例句请分别控制在1000个字以内。'
  return ''
}
export function upsertVocabulary(cards: VocabularyCard[], card: VocabularyCard): VocabularyCard[] {
  const key = vocabularyKey(card.word)
  // A second click or normalized duplicate must not destroy an existing definition or create another card.
  if (cards.some(c => c.id !== card.id && vocabularyKey(c.word) === key)) return cards
  return cards.some(c => c.id === card.id) ? cards.map(c => c.id === card.id ? card : c) : [...cards, card]
}
export function vocabularySource(pageNo: number | null, text: string, word: string): Source | null {
  if (pageNo === null) return null
  const index = text.indexOf(word.trim())
  return { page_no: pageNo, source: 'original_page', start_ms: null, end_ms: null,
    quote: index < 0 ? '' : text.slice(Math.max(0, index - 40), index + word.trim().length + 80) }
}
