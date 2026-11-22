import { describe, expect, it } from 'vitest';
import { loadRunPageImage, pickPageImageAsset } from '../runVideo';

const assets = [
  { id: 'p1', asset_type: 'image', mime_type: 'image/png', sha256: 'a', metadata_json: '{"page_no":1}', created_at: '2026-01-01' },
  { id: 'p2', asset_type: 'image', mime_type: 'image/png', sha256: 'b', metadata_json: '{"page_no":2}', created_at: '2026-02-01' },
  { id: 'bad', asset_type: 'image', mime_type: 'image/png', sha256: 'c', metadata_json: '{', created_at: '2026-03-01' },
];

describe('run illustration integration', () => {
  it('does not substitute an illustration from another page', () => {
    expect(pickPageImageAsset(assets, 1)?.id).toBe('p1');
    expect(pickPageImageAsset(assets, 3)).toBeNull();
  });
  it('downloads only the selected page and rejects empty content', async () => {
    const downloads: string[] = [];
    const api = { getRunAssets: async () => assets,
      getAssetContent: async (_run: string, id: string) => { downloads.push(id); return new Blob(['image'], { type: 'image/png' }); } };
    expect(await loadRunPageImage(api, 'r', 2, () => 'blob:p2')).toBe('blob:p2');
    expect(downloads).toEqual(['p2']);
    expect(await loadRunPageImage(api, 'r', 3, () => 'unused')).toBeNull();
    await expect(loadRunPageImage({ ...api, getAssetContent: async () => new Blob() }, 'r', 1, () => 'unused')).rejects.toThrow('插画产物内容为空');
  });
});
