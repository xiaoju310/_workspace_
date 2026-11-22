"""Local bounded PDF rasterization. No scripts, attachments, cloud or source retention."""
from contextlib import closing
import base64
import io
import math
import threading
from fastapi import HTTPException

_GATE = threading.BoundedSemaphore(1)
MAX_BYTES = 30 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024 * 1024

def render_pdf(raw: bytes, max_pages: int = 100):
    if not isinstance(max_pages, int) or isinstance(max_pages, bool) or not 1 <= max_pages <= 100:
        raise HTTPException(422, '剩余页数需要在 1–100 之间')
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, 'PDF 超过 30 MB，请拆分后重试')
    if not raw.startswith(b'%PDF-'):
        raise HTTPException(422, '文件内容不是 PDF')
    if not _GATE.acquire(blocking=False):
        raise HTTPException(429, '正在解析另一份 PDF，请稍后重试')
    try:
        try:
            import pypdfium2 as pdfium
        except ImportError:
            raise HTTPException(503, '服务器未安装 PDF 解析组件，请安装后端依赖后重启') from None
        pages = []
        total_bytes = 0
        try:
            with pdfium.PdfDocument(raw) as document:
                if not 1 <= len(document) <= max_pages:
                    raise HTTPException(422, f'PDF 页数超过剩余可导入页数（{max_pages} 页），未导入任何页')
                for index in range(len(document)):
                    with closing(document[index]) as page:
                        width, height = page.get_size()
                        if not all(math.isfinite(x) and x > 0 for x in (width, height)):
                            raise ValueError('invalid page size')
                        scale = min(2, 2000 / max(width, height))
                        bitmap = page.render(scale=scale)
                        try:
                            with bitmap.to_pil() as rendered:
                                image = rendered.convert('RGB')
                            try:
                                output = io.BytesIO()
                                image.save(output, format='JPEG', quality=90)
                            finally:
                                image.close()
                        finally:
                            bitmap.close()
                        data = output.getvalue()
                        total_bytes += len(data)
                        if total_bytes > MAX_OUTPUT_BYTES:
                            raise HTTPException(413, 'PDF 展开图片过大，请拆分后重试')
                        pages.append({'page_no': index + 1, 'image_base64': base64.b64encode(data).decode('ascii')})
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, 'PDF 无法解析、已损坏或需要密码；未导入任何页') from None
        return {'pages': pages, 'page_count': len(pages), 'processing': 'server_local_no_cloud', 'source_storage': 'not_retained'}
    finally:
        _GATE.release()
