import { apiClient } from './api';
import type { ReadingBook, ReadingNote, ShareGrant, Interaction } from '../app/types';

export interface MobileWorkspace {
  schema: 1;
  books: ReadingBook[];
  notes: ReadingNote[];
  grants: ShareGrant[];
  interactions: Interaction[];
}

/** Store only metadata in MongoDB; raw uploaded images live in MongoDB GridFS. */
export function packWorkspace(state: MobileWorkspace): MobileWorkspace {
  return {
    ...state,
    books: state.books.filter(b => b.server_book_id).map(b => ({
      ...b,
      pages: b.pages.map(p => ({ ...p, image_url: '', demo: false })),
    })),
    notes: state.notes.filter(n => state.books.some(b => b.id === n.book_id && b.server_book_id)),
    grants: state.grants.filter(g => state.books.some(b => b.server_book_id && state.notes.some(n => n.book_id === b.id && n.id === g.note_id))),
    interactions: state.interactions.filter(i => state.books.some(b => b.id === i.book_id && b.server_book_id)),
  };
}

export async function loadMobileWorkspace(): Promise<MobileWorkspace | null> {
  const response = await apiClient.mobileWorkspace();
  if (!response.state) return null;
  const state = response.state as MobileWorkspace;
  if (state.schema !== 1 || !Array.isArray(state.books)) throw new Error('MongoDB 中的阅读记录格式不兼容');
  const books = await Promise.all(state.books.map(async book => {
    if (!book.server_book_id) return book;
    const pages = await Promise.all(book.pages.map(async page => {
      if (!page.server_page_no) return page;
      const image = await apiClient.pageContent(book.server_book_id!, page.server_page_no);
      return { ...page, image_url: URL.createObjectURL(image) };
    }));
    return { ...book, pages };
  }));
  return { ...state, books };
}

export async function saveMobileWorkspace(state: MobileWorkspace): Promise<void> {
  await apiClient.saveMobileWorkspace(packWorkspace(state));
}
