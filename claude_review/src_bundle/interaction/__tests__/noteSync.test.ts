import { describe, it, expect } from 'vitest';
import { reviewOnServer, createShareOnServer, revokeShareOnServer, serverStatusToLocal } from '../../../lib/noteSync';

const note = (status: string) => ({ id: 'n', book_id: 'b', owner_id: 'u', content: {}, status, version: 1, created_at: '', updated_at: '' }) as any;

describe('笔记审核/分享以服务端为准（真实 noteSync）', () => {
  it('状态映射遵循 A 契约：PRIVATE=已审核', () => {
    expect(serverStatusToLocal('PRIVATE')).toBe('approved');
    expect(serverStatusToLocal('REVIEWING')).toBe('in_review');
    expect(serverStatusToLocal('DRAFT')).toBe('draft');
    expect(serverStatusToLocal('REVOKED')).toBe('draft');
  });

  it('approve：服务端返回 PRIVATE 才算通过；返回别的状态抛错', async () => {
    expect((await reviewOnServer({ reviewNote: async () => note('PRIVATE') } as any, 'n', 'approve')).local).toBe('approved');
    await expect(reviewOnServer({ reviewNote: async () => note('DRAFT') } as any, 'n', 'approve')).rejects.toThrow('未确认通过');
  });

  it('审核被服务端拒绝(409)：抛错，调用方据此不改本地', async () => {
    const api = { reviewNote: async () => { throw new Error('缺来源引用不允许审核通过'); } } as any;
    await expect(reviewOnServer(api, 'n', 'approve')).rejects.toThrow('缺来源引用');
  });

  it('创建分享：link 必须拿到 token；服务端失败/缺 token 都抛错', async () => {
    const mk = (out: any) => ({ createNoteShare: async () => out }) as any;
    const s = await createShareOnServer(mk({ id: 's1', token: 'T', expires_at: null }), 'n', { mode: 'link', recipients: [], expiresAt: 'x' });
    expect(s).toMatchObject({ id: 's1', token: 'T' });
    await expect(createShareOnServer(mk({ id: 's1', token: null }), 'n', { mode: 'link', recipients: [], expiresAt: 'x' })).rejects.toThrow('令牌');
    const fail = { createNoteShare: async () => { throw new Error('未审核'); } } as any;
    await expect(createShareOnServer(fail, 'n', { mode: 'link', recipients: [], expiresAt: 'x' })).rejects.toThrow('未审核');
  });

  it('指定用户：一次只能 1 位，并传 shared_user_id', async () => {
    let seen: any;
    const api = { createNoteShare: async (_n: string, _m: string, o: any) => { seen = o; return { id: 's', token: null }; } } as any;
    await createShareOnServer(api, 'n', { mode: 'invite_only', recipients: ['u2'], expiresAt: 'x' });
    expect(seen.shared_user_id).toBe('u2');
    await expect(createShareOnServer(api, 'n', { mode: 'invite_only', recipients: ['a', 'b'], expiresAt: 'x' })).rejects.toThrow('1 位');
  });

  it('撤销失败必须抛错（不能假装已撤销）', async () => {
    await expect(revokeShareOnServer({ revokeNoteShare: async () => { throw new Error('网络'); } } as any, 'n', 's')).rejects.toThrow('网络');
  });
});
