import { validatePage, type ImportPage } from './import'

export interface PdfPreview { page_count: number; pages: { page_no: number; image_base64: string }[] }

/** One PDF is atomic: do not retain any page or temporary URL if a later page fails. */
export async function materializePdfPages(preview: PdfPreview, name: string, remaining: number, assertActive: () => void): Promise<ImportPage[]> {
  const pages: ImportPage[] = []
  try {
    assertActive()
    if (!Array.isArray(preview.pages) || !Number.isInteger(preview.page_count) || preview.page_count < 1 ||
        preview.page_count > remaining || preview.pages.length !== preview.page_count) throw new Error('PDF 页数与返回书页不一致或超过剩余位置，未添加任何页。')
    let totalBytes = 0
    for (const [index, page] of preview.pages.entries()) {
      assertActive()
      if (page.page_no !== index + 1 || typeof page.image_base64 !== 'string') throw new Error('PDF 页码不连续，未添加任何页。')
      const bytes = Uint8Array.from(atob(page.image_base64), c => c.charCodeAt(0))
      totalBytes += bytes.length
      if (totalBytes > 64 * 1024 * 1024) throw new Error('PDF 展开图片过大，未添加任何页。')
      const file = new File([bytes], `${name.replace(/\.pdf$/i, '')}-${String(page.page_no).padStart(3, '0')}.jpg`, { type: 'image/jpeg' })
      const error = await validatePage(file)
      assertActive()
      if (error) throw new Error(error)
      pages.push({ id: crypto.randomUUID(), name: file.name, size: file.size, file, url: URL.createObjectURL(file) })
    }
    return pages
  } catch (error) {
    pages.forEach(page => URL.revokeObjectURL(page.url))
    throw error
  }
}
