import type { Book } from '../features/books/types'
import type { NoteDraft } from '../features/notes/types'

// 全部为原创虚构演示书，不代表真实生成、分类或阅读记录。
export const books: Book[] = [
  { id: 'demo-forest', title: '森林里的来信', subtitle: '在一封信里，遇见新的朋友。', cover: '/art/cover-forest.svg', page_count: 12, status: 'READY', updated_label: '今天', classification: { predicted_type: 'picture_book', confidence: 0.96, reasons: ['图像为主，连续的故事结构'], confirmed_type: 'picture_book', owner_confirmed: true } },
  { id: 'demo-moon', title: '月亮邮局', subtitle: '把小小的心愿，寄给月亮。', cover: '/art/cover-moon.svg', page_count: 16, status: 'REVIEW_REQUIRED', updated_label: '昨天', classification: { predicted_type: 'fiction', confidence: 0.62, reasons: ['叙事文本较多，需主人确认'], confirmed_type: null, owner_confirmed: false } },
  { id: 'demo-seed', title: '一颗种子的旅行', subtitle: '跟着一颗种子，认识四季。', cover: '/art/cover-seed.svg', page_count: 10, status: 'GENERATING', updated_label: '昨天', classification: { predicted_type: 'nonfiction', confidence: 0.91, reasons: ['植物生长的概念与过程说明'], confirmed_type: 'nonfiction', owner_confirmed: true } },
]

export const notes: NoteDraft[] = [
  { id: 'note-forest', book_id: 'demo-forest', title: '关于勇气与友谊的三个发现', summary: '小狐狸走出家门，也学会了表达自己的心意。', concepts: ['勇气', '友谊'], sources: [{ page_no: 3, quote: '原创演示引用，非真实书籍内容。' }], review_status: 'approved', visibility: 'private', owner_reviewed: true },
  { id: 'note-moon', book_id: 'demo-moon', title: '那些想对月亮说的话', summary: '一份等待主人审阅的阅读草稿。', concepts: ['表达'], sources: [{ page_no: 2, quote: '原创演示引用，非真实书籍内容。' }], review_status: 'draft', visibility: 'private', owner_reviewed: false },
]
