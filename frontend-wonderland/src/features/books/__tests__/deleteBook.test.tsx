import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IDBFactory } from 'fake-indexeddb'
import { withoutBook } from '../deleteBook'
import { DraftStore, type WorkspaceDraft } from '../draftStore'
import { initialBooks, initialNotes } from '../../../mock/workspace'
import HomePage from '../../../pages/HomePage'
import { createApiClient } from '../../../api/client'

function workspace(): WorkspaceDraft {
  const books = initialBooks()
  const notes = [initialNotes()[0], {...initialNotes()[0], id: 'other-note', book_id: books[1].id}]
  return {books, notes, grants: notes.map(n => ({id: n.id, token: n.id, note_id: n.id, note_revision: 1, snapshot: n, mode: 'expiring_link', recipients: [], expires_at: '', status: 'active', created_at: ''})), interactions: []}
}

describe('删除图书', () => {
  it('只删除目标图书及笔记和分享，不改变输入或其他书', () => {
    const data = workspace(), next = withoutBook(data, data.books[0].id)
    expect(next.books.map(b => b.id)).toEqual(data.books.slice(1).map(b => b.id))
    expect(next.notes.map(n => n.id)).toEqual(['other-note'])
    expect(next.grants.map(g => g.note_id)).toEqual(['other-note'])
    expect(data.books).toHaveLength(3)
    expect(withoutBook(data, 'missing')).toEqual(data)
  })
  it('关联阅读记录删除，其他图书记录保留', () => {
    const data = workspace()
    const record = {id: 'q', book_id: data.books[0].id, run_id: 'run', kind: 'question' as const, question: '', answer: '', transcript: '', video_ms: 0, sources: [], latency_ms: null, created_at: '', uncertain: false, origin: 'mock' as const, cached: false}
    data.interactions = [record, {...record, id: 'other', book_id: data.books[1].id}]
    expect(withoutBook(data, data.books[0].id).interactions.map(i => i.id)).toEqual(['other'])
  })
  it('删除全部后刷新仍为空，独立导入草稿及其原图不受影响', async () => {
    const factory = new IDBFactory(), store = new DraftStore(factory, 'delete-test')
    await store.saveImport('demo', {id: 'draft', title: '未完成的新书', authorizationRef: '原创', authorized: true, type: 'picture_book', pages: [{id: 'draft-page', name: '1.png', size: 3, url: 'blob:old', file: new File(['abc'], '1.png', {type:'image/png'})}]})
    let data = workspace()
    await store.saveWorkspace('demo', data)
    for (const book of [...data.books]) data = withoutBook(data, book.id)
    await store.saveWorkspace('demo', data)
    const reopened = new DraftStore(factory, 'delete-test')
    expect((await reopened.loadWorkspace('demo'))?.data).toEqual({books:[],notes:[],grants:[],interactions:[]})
    const draft = await reopened.loadImport('demo', 'draft')
    expect(await draft?.pages[0].file?.text()).toBe('abc')
    draft?.pages.forEach(p => URL.revokeObjectURL(p.url))
  })
  it('书架显示删除入口，生成中的书禁止删除，空书架有导入提示', () => {
    const props = {state: 'success' as const, setState: vi.fn(), onImport: vi.fn(), onBook: vi.fn(), onNote: vi.fn(), onDeleteBook: vi.fn(), notes: []}
    const books = initialBooks(); books[1].status = 'GENERATING'
    const html = renderToStaticMarkup(<HomePage {...props} books={books}/>)
    expect(html).toContain(`aria-label="删除《${books[0].title}》"`)
    expect(html).toMatch(new RegExp(`disabled=""[^>]*aria-label="删除《${books[1].title}》"`))
    expect(renderToStaticMarkup(<HomePage {...props} books={[]}/>)).toContain('导入')
  })
  it('DELETE 请求使用授权头并对图书 ID 编码，204 不读取 JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {status:204}))
    const api = createApiClient('http://localhost:8000', {getToken: () => 'test-only', fetch: fetcher})
    await expect(api.deleteBook('a/b')).resolves.toBeUndefined()
    expect(fetcher.mock.calls[0][0]).toContain('/api/books/a%2Fb')
    expect(fetcher.mock.calls[0][1].method).toBe('DELETE')
    expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-only')
  })
})
