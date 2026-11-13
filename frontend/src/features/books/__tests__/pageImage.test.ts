import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pageImageBlob, MAX_PAGE_IMAGE_BYTES } from '../pageImage';

describe('pageImageBlob 书页图片大小与格式守护', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('书页图片超过 10MB 时立即抛出明确错误，防止打崩后端或报 413/422', async () => {
    const hugeBlob = new Blob([new Uint8Array(MAX_PAGE_IMAGE_BYTES + 1024)], { type: 'image/png' });
    vi.mocked(fetch).mockResolvedValueOnce({
      blob: async () => hugeBlob,
    } as any);

    await expect(pageImageBlob('blob:http://localhost/huge-image')).rejects.toThrow(
      /书页图片大小超过限制.*10MB/
    );
  });

  it('小于 10MB 的 PNG/JPEG 图片直接透传', async () => {
    const validBlob = new Blob([new Uint8Array(1024)], { type: 'image/png' });
    vi.mocked(fetch).mockResolvedValueOnce({
      blob: async () => validBlob,
    } as any);

    const res = await pageImageBlob('blob:http://localhost/valid-image');
    expect(res).toBe(validBlob);
    expect(res.size).toBe(1024);
  });
});
