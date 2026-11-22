export type ReviewStatus = 'draft' | 'in_review' | 'approved' | 'rejected'
export interface NoteDraft {
  id: string
  book_id: string
  title: string
  summary: string
  concepts: string[]
  sources: { page_no: number; quote: string }[]
  review_status: ReviewStatus
  visibility: 'private' | 'shared'
  owner_reviewed: boolean
}
