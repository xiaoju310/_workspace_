import type { WorkspaceDraft } from './draftStore'

/** 按图书归属移除关联记录；保留其他图书和独立导入草稿。 */
export function withoutBook(data: WorkspaceDraft, bookId: string): WorkspaceDraft {
  const removedNotes = new Set(data.notes.filter(n => n.book_id === bookId).map(n => n.id))
  return {
    books: data.books.filter(b => b.id !== bookId),
    notes: data.notes.filter(n => n.book_id !== bookId),
    grants: data.grants.filter(g => !removedNotes.has(g.note_id) && g.snapshot.book_id !== bookId),
    interactions: data.interactions.filter(i => i.book_id !== bookId),
  }
}
