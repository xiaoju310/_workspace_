"""Generated in-memory PDFs and isolated data only; never starts paid providers."""
import base64
import io
import builtins
import pytest
from PIL import Image
from fastapi import HTTPException
from app.services import pdf_import
from test_library_sync import client


def pdf_bytes(colors=('red', 'green', 'blue'), size=(60, 90)):
    images = [Image.new('RGB', size, color) for color in colors]
    try:
        out = io.BytesIO()
        images[0].save(out, 'PDF', save_all=True, append_images=images[1:])
        return out.getvalue()
    finally:
        for image in images:
            image.close()


def test_real_pdf_order_jpeg_pixels_and_no_source_storage(client, monkeypatch):
    from app.services import cloud_vision
    monkeypatch.setattr(cloud_vision, 'call_json', lambda *a, **kw: pytest.fail('PDF must not call a model'))
    result = client.post('/api/library/pdf/preview?max_pages=3', content=pdf_bytes(), headers={'Content-Type': 'application/pdf'})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['page_count'] == 3
    assert data['processing'] == 'server_local_no_cloud' and data['source_storage'] == 'not_retained'
    assert [p['page_no'] for p in data['pages']] == [1, 2, 3]
    for page, expected in zip(data['pages'], [(255,0,0), (0,128,0), (0,0,255)]):
        raw = base64.b64decode(page['image_base64'])
        with Image.open(io.BytesIO(raw)) as image:
            assert image.format == 'JPEG'
            assert image.size == (120, 180)
            assert all(abs(a-b) < 12 for a,b in zip(image.getpixel((60,90)), expected))
    from app import db
    with db.get_connection() as connection:
        assert connection.execute('SELECT COUNT(*) FROM books').fetchone()[0] == 0
    assert client.get('/api/library/drafts').json() == []


def test_real_pdf_scales_long_side_to_2000():
    data = pdf_import.render_pdf(pdf_bytes(('white',), (1500, 600)))
    with Image.open(io.BytesIO(base64.b64decode(data['pages'][0]['image_base64']))) as image:
        assert max(image.size) <= 2000
        assert image.width / image.height == pytest.approx(2.5, rel=.01)


@pytest.mark.parametrize('raw', [b'', b'not pdf', b'%PDF-1.7\nbroken'])
def test_bad_pdf_is_atomic_and_gate_released(raw):
    with pytest.raises(HTTPException) as error:
        pdf_import.render_pdf(raw)
    assert error.value.status_code == 422
    assert pdf_import.render_pdf(pdf_bytes(('red',)))['page_count'] == 1


def test_remaining_page_limit_no_partial_result():
    with pytest.raises(HTTPException) as error:
        pdf_import.render_pdf(pdf_bytes(), 2)
    assert error.value.status_code == 422
    assert pdf_import.render_pdf(pdf_bytes(), 3)['page_count'] == 3


@pytest.mark.parametrize('limit', [0, 101, -1, True, 1.5])
def test_service_enforces_absolute_page_cap(limit):
    with pytest.raises(HTTPException) as error:
        pdf_import.render_pdf(b'%PDF-', limit)
    assert error.value.status_code == 422


def test_upload_auth_type_size_and_query_limits(client, monkeypatch):
    endpoint = '/api/library/pdf/preview'
    raw = pdf_bytes(('red',))
    assert client.post(endpoint, content=raw, headers={'Content-Type':'image/jpeg'}).status_code == 415
    for value in (0, 101, 'invalid'):
        assert client.post(endpoint+f'?max_pages={value}', content=raw, headers={'Content-Type':'application/pdf'}).status_code == 422
    monkeypatch.setattr(pdf_import, 'MAX_BYTES', 20)
    assert client.post(endpoint, content=raw, headers={'Content-Type':'application/pdf'}).status_code == 413
    with pytest.raises(HTTPException) as error:
        pdf_import.render_pdf(raw)
    assert error.value.status_code == 413
    client.headers.clear()
    assert client.post(endpoint, content=raw, headers={'Content-Type':'application/pdf'}).status_code == 401


def test_busy_and_output_limits_release_gate(monkeypatch):
    pdf_import._GATE.acquire()
    try:
        with pytest.raises(HTTPException) as error:
            pdf_import.render_pdf(pdf_bytes(('red',)))
        assert error.value.status_code == 429
    finally:
        pdf_import._GATE.release()
    monkeypatch.setattr(pdf_import, 'MAX_OUTPUT_BYTES', 1)
    with pytest.raises(HTTPException) as error:
        pdf_import.render_pdf(pdf_bytes())
    assert error.value.status_code == 413
    monkeypatch.setattr(pdf_import, 'MAX_OUTPUT_BYTES', 64*1024*1024)
    assert pdf_import.render_pdf(pdf_bytes(('red',)))['page_count'] == 1


def test_missing_component_is_explicit_and_gate_released(monkeypatch):
    original = builtins.__import__
    def importing(name, *args, **kwargs):
        if name == 'pypdfium2':
            raise ImportError('test')
        return original(name, *args, **kwargs)
    with monkeypatch.context() as patch:
        patch.setattr(builtins, '__import__', importing)
        with pytest.raises(HTTPException) as error:
            pdf_import.render_pdf(b'%PDF-1.7')
        assert error.value.status_code == 503
    assert pdf_import.render_pdf(pdf_bytes(('red',)))['page_count'] == 1


def test_real_password_protected_pdf_rejected_and_gate_released():
    from pathlib import Path
    import pypdfium2 as pdfium
    raw = (Path(__file__).parent / 'fixtures' / 'password-protected.pdf').read_bytes()
    # Self-generated AES-256 fixture; verify it is a valid locked PDF, not corrupt bytes.
    with pdfium.PdfDocument(raw, password='reader-test-only') as document:
        assert len(document) == 1
    with pytest.raises(HTTPException) as error:
        pdf_import.render_pdf(raw)
    assert error.value.status_code == 422
    assert '密码' in error.value.detail
    assert pdf_import.render_pdf(pdf_bytes(('red',)))['page_count'] == 1


def test_pdf_pages_upload_roundtrip_and_account_isolation(client, monkeypatch):
    from app.services import cloud_vision
    monkeypatch.setattr(cloud_vision, 'call_json', lambda *a, **kw: pytest.fail('Import must not call a model'))
    response = client.post('/api/library/pdf/preview', content=pdf_bytes(), headers={'Content-Type': 'application/pdf'})
    assert response.status_code == 200
    pages = response.json()['pages']
    response = client.post('/api/books', json={'title': 'PDF upload test', 'authorization_ref': 'self-generated test'})
    assert response.status_code == 201
    book = response.json()['id']
    for page in pages:
        raw = base64.b64decode(page['image_base64'])
        response = client.post(f'/api/books/{book}/pages?page_no={page["page_no"]}', content=raw, headers={'Content-Type': 'image/jpeg'})
        assert response.status_code == 201, response.text
        assert response.json()['page_no'] == page['page_no']
        assert client.get(f'/api/library/books/{book}/pages/{page["page_no"]}/image').content == raw
    rows = client.get('/api/library/books').json()
    assert [p['page_no'] for p in rows[0]['pages']] == [1, 2, 3]
    client.headers['Authorization'] = 'Bearer b-secret'
    assert client.get('/api/library/books').json() == []
    assert client.get(f'/api/library/books/{book}/pages/1/image').status_code == 404
