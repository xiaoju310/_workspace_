export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PAGES = 24
export const ACCEPTED_MIME = ['image/jpeg', 'image/png']
export interface ImportPage { id: string; name: string; url: string; size: number; demo?: boolean }

export async function validatePage(file: File): Promise<string | null> {
  if (!ACCEPTED_MIME.includes(file.type) || !/\.(jpe?g|png)$/i.test(file.name)) return `${file.name}：仅支持 JPG / PNG 图片。`
  if (file.size === 0) return `${file.name}：文件为空，请重新选择。`
  if (file.size > MAX_FILE_BYTES) return `${file.name}：超过 10 MB，请压缩后重试。`
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const isPng = bytes.length === 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if ((file.type === 'image/png' && !isPng) || (file.type === 'image/jpeg' && !isJpeg)) return `${file.name}：文件内容与图片类型不符。`
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) return `${file.name}：图片无法读取。`
    return null
  } catch { return `${file.name}：图片损坏或无法解码，请重新导出。` }
  finally { URL.revokeObjectURL(url) }
}
