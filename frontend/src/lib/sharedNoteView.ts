/**
 * Live 只读分享访问（扩展任务 D8~D10「联调分享开关、过期、撤销和只读访问」，E-029）。
 *
 * 旧实现：只读页只看"当前浏览器里的本地授权快照"。服务端发放的链接复制到另一台设备/浏览器打开，
 * 一律显示"没有找到这份分享"；服务端撤销/过期也从不核验——访问控制实际上是本地模拟。
 *
 * 现在 Live 下只读页一律向 A 读取：
 *  - 限时链接：GET /api/shared-notes/{token}（无需登录；404=无效或已撤销，410=已过期，403=未审核）
 *  - 指定用户：GET /api/notes/{note_id}/shares/{share_id}/view（必须用被邀请人自己的令牌）
 * 页面展示的内容以服务端返回为准，不再使用本地快照。
 */
import { ApiError } from '../api/client';
import type { BackendNoteOut } from '../types/interaction';

export type SharedRef = { kind: 'link'; token: string } | { kind: 'invite'; noteId: string; shareId: string };

export function parseSharedRef(query: URLSearchParams): SharedRef | null {
  const token = query.get('token')?.trim();
  if (token) return { kind: 'link', token };
  const noteId = query.get('note')?.trim();
  const shareId = query.get('share')?.trim();
  if (noteId && shareId) return { kind: 'invite', noteId, shareId };
  return null;
}

/** 服务端分享的访问地址：限时链接带明文令牌；指定用户只带 ID，访问者必须以本人身份登录 */
export function serverShareHash(input: { mode: 'link' | 'invite_only'; token?: string | null; noteId: string; shareId: string }): string {
  if (input.mode === 'link') {
    if (!input.token) throw new Error('限时链接缺少令牌');
    return `#/shared?token=${encodeURIComponent(input.token)}`;
  }
  return `#/shared?note=${encodeURIComponent(input.noteId)}&share=${encodeURIComponent(input.shareId)}`;
}

export interface SharedNoteView {
  title: string;
  summary: string;
  concepts: string[];
  sources: { page_no: number; quote: string; start_ms: number | null }[];
  version: number;
  status: string;
}

export type SharedLoadResult =
  | { status: 'ok'; note: SharedNoteView }
  | { status: 'denied'; code: string; title: string; detail: string };

export interface SharedNoteApi {
  getSharedNote(token: string): Promise<BackendNoteOut>;
  getInvitedNote(noteId: string, shareId: string): Promise<BackendNoteOut>;
}

export function toSharedNoteView(note: BackendNoteOut): SharedNoteView {
  const c = note.content ?? {};
  const sources = Array.isArray(c.sources) ? c.sources : [];
  return {
    title: typeof c.title === 'string' && c.title.trim() ? c.title : '（未命名笔记）',
    summary: typeof c.summary === 'string' ? c.summary : '',
    concepts: Array.isArray(c.concepts) ? c.concepts.filter((x: unknown): x is string => typeof x === 'string') : [],
    sources: sources
      .filter((s: any) => s && Number.isInteger(s.page_no))
      .map((s: any) => ({ page_no: s.page_no, quote: typeof s.quote === 'string' ? s.quote : '', start_ms: typeof s.start_ms === 'number' ? s.start_ms : null })),
    version: note.version,
    status: note.status,
  };
}

/** 服务端拒绝 → 明确原因；网络/超时等其它错误 → 也归为 denied，但写清楚"未能核验"，不能显示内容 */
export function describeShareError(error: unknown, ref: SharedRef): { code: string; title: string; detail: string } {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 404:
        return ref.kind === 'link'
          ? { code: 'NOT_FOUND', title: '这份分享无效或已经撤销', detail: '服务端没有找到有效的分享令牌。' }
          : { code: 'NOT_FOUND', title: '你不在邀请名单中，或邀请已撤销', detail: '服务端核验了当前登录身份，未找到发给你的有效邀请。' };
      case 410:
        return { code: 'GONE', title: '这份分享已经过期', detail: '请联系主人重新创建分享。' };
      case 403:
        return { code: 'FORBIDDEN', title: '这份笔记尚未通过主人审核', detail: '未审核的笔记不能被查看。' };
      case 401:
        return { code: error.code, title: '需要以被邀请人的身份登录', detail: '指定用户分享必须使用被邀请人自己的令牌访问。请在设置里填写你的令牌后重试。' };
      default:
        return { code: error.code, title: '暂时无法核验这份分享', detail: `${error.message}（未显示任何内容）` };
    }
  }
  return { code: 'UNKNOWN', title: '暂时无法核验这份分享', detail: `${(error as any)?.message ?? error}（未显示任何内容）` };
}

export async function loadSharedNote(api: SharedNoteApi, ref: SharedRef): Promise<SharedLoadResult> {
  try {
    const note = ref.kind === 'link' ? await api.getSharedNote(ref.token) : await api.getInvitedNote(ref.noteId, ref.shareId);
    return { status: 'ok', note: toSharedNoteView(note) };
  } catch (error) {
    return { status: 'denied', ...describeShareError(error, ref) };
  }
}
