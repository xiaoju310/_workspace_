/**
 * 取书页图片字节用于上传。A 只接受 PNG/JPEG，原创示例页是 SVG，需要先在浏览器里栅格化成 PNG。
 */
export async function pageImageBlob(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
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
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('书页图片转换失败。'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
