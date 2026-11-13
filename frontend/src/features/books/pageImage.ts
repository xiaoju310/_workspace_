/**
 * 取书页图片字节用于上传。A 只接受 PNG/JPEG，大小上限 10MB；原创示例页是 SVG，需要先在浏览器里栅格化成 PNG。
 */
export const MAX_PAGE_IMAGE_BYTES = 10 * 1024 * 1024;

export async function pageImageBlob(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
  if (blob.size > MAX_PAGE_IMAGE_BYTES) {
    throw new Error(`书页图片大小超过限制（${(blob.size / 1024 / 1024).toFixed(1)}MB > 10MB），请压缩后重新上传。`);
  }
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') return blob;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('书页图片无法解码，不能上传。'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || 1200;
    canvas.height = image.naturalHeight || 1600;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法转换书页图片。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('书页图片转换失败。'))), 'image/png');
    });
    if (png.size > MAX_PAGE_IMAGE_BYTES) {
      throw new Error(`转换后的书页图片大小超过限制（${(png.size / 1024 / 1024).toFixed(1)}MB > 10MB），请压缩后重新上传。`);
    }
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
