export type BookType = 'picture_book' | 'fiction' | 'nonfiction' | 'unknown'
export type ProcessingStatus = 'READY' | 'REVIEW_REQUIRED' | 'GENERATING' | 'FAILED'
export type PreviewState = 'success' | 'loading' | 'empty' | 'error'

export interface Classification {
  predicted_type: BookType
  confidence: number | null
  reasons: string[]
  confirmed_type: BookType | null
  owner_confirmed: boolean
}

export interface Book {
  id: string
  title: string
  subtitle: string
  cover: string
  page_count: number
  status: ProcessingStatus
  classification: Classification
  updated_label: string
}

export const bookTypeLabels: Record<BookType, string> = {
  picture_book: '绘本', fiction: '文学故事', nonfiction: '知识读物', unknown: '待确认',
}
