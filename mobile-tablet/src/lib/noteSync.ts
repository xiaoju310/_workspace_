/**
 * 笔记审核 / 分享的"服务端为准"同步层（纯函数 + 注入 API，便于单测）。
 *
 * 原则：先让服务端成功，再改本地状态。服务端失败 → 抛错，调用方不得改动本地状态，
 * 更不能提示"已成功"。状态词汇以 A 的 api-contract 为准：
 *   DRAFT → REVIEWING → PRIVATE(approve) → SHARED → REVOKED
 */
import type { BackendNoteOut, BackendShareOut } from '../types/interaction';

export interface NoteServerApi {
  reviewNote(noteId: string, action: 'approve' | 'revise'): Promise<BackendNoteOut>;
  createNoteShare(
    noteId: string,
    mode: 'link' | 'invite_only',
    opts?: { shared_user_id?: string; expires_at?: string }
  ): Promise<BackendShareOut>;
  revokeNoteShare(noteId: string, shareId: string): Promise<void>;
}

export type LocalReviewStatus = 'draft' | 'in_review' | 'approved';

export function serverStatusToLocal(status: string): LocalReviewStatus {
  switch (status) {
    case 'REVIEWING':
      return 'in_review';
    case 'PRIVATE':
    case 'SHARED':
      return 'approved';
    default:
      return 'draft'; // DRAFT / REVOKED / 未知 都按未通过处理（保守）
  }
}

/** 审核：返回服务端确认后的本地状态；服务端没有给出预期状态则抛错 */
export async function reviewOnServer(
  api: NoteServerApi,
  serverNoteId: string,
  action: 'approve' | 'revise'
): Promise<{ status: string; local: LocalReviewStatus; version: number }> {
  const out = await api.reviewNote(serverNoteId, action);
  const local = serverStatusToLocal(out.status);
  if (action === 'approve' && local !== 'approved') {
    throw new Error(`服务端未确认通过（当前状态 ${out.status}）`);
  }
  if (action === 'revise' && local === 'approved') {
    throw new Error(`服务端未退回修改（当前状态 ${out.status}）`);
  }
  return { status: out.status, local, version: out.version };
}

export interface ServerShare {
  id: string;
  token: string | null;
  expires_at: string | null;
  mode: 'link' | 'invite_only';
}

/** 创建分享：link 模式的明文 token 只在创建响应里返回一次，缺失即视为失败 */
export async function createShareOnServer(
  api: NoteServerApi,
  serverNoteId: string,
  input: { mode: 'link' | 'invite_only'; recipients: string[]; expiresAt: string }
): Promise<ServerShare> {
  if (input.mode === 'invite_only' && input.recipients.length !== 1) {
    throw new Error('真实模式下指定用户分享一次只支持 1 位被邀请用户');
  }
  const out = await api.createNoteShare(serverNoteId, input.mode, {
    shared_user_id: input.mode === 'invite_only' ? input.recipients[0] : undefined,
    expires_at: input.expiresAt,
  });
  if (!out?.id) throw new Error('服务端未返回分享 ID');
  if (input.mode === 'link' && !out.token) throw new Error('服务端没有返回分享令牌，链接不可用');
  return { id: out.id, token: out.token ?? null, expires_at: out.expires_at ?? null, mode: input.mode };
}

/** 撤销：服务端成功才返回；失败抛错，调用方保持"仍有效"并如实告知 */
export async function revokeShareOnServer(api: NoteServerApi, serverNoteId: string, shareId: string): Promise<void> {
  await api.revokeNoteShare(serverNoteId, shareId);
}

/**
 * 本地笔记 → A 的 content。A 只有在 summary 非空且 sources 非空时才解除占位，
 * 占位笔记不允许审核通过；is_placeholder 由服务端决定，这里不发送。
 */
export function noteToServerContent(note: {
  title: string;
  summary: string;
  concepts: string[];
  sources: { page_no: number; quote: string; start_ms: number | null; end_ms: number | null }[];
}): Record<string, unknown> {
  return {
    title: note.title,
    summary: note.summary,
    concepts: note.concepts,
    sources: note.sources.map((s) => ({ page_no: s.page_no, quote: s.quote, start_ms: s.start_ms, end_ms: s.end_ms })),
  };
}
