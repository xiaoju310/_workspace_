import json
import sqlite3
import pytest
import requests
from app.ai.video_doubao import ArkAPIError, DoubaoProvider
from app.services.video_diagnostics import failure_details, failure_message


@pytest.mark.parametrize('exception,code', [
    (requests.exceptions.SSLError, 'TLS_ERROR'),
    (requests.exceptions.ProxyError, 'PROXY_ERROR'),
    (requests.ConnectTimeout, 'CONNECT_TIMEOUT'),
    (requests.ReadTimeout, 'READ_TIMEOUT'),
    (requests.ConnectionError, 'CONNECTION_ERROR'),
    (requests.RequestException, 'REQUEST_ERROR'),
    (sqlite3.OperationalError, 'DATABASE_ERROR'),
    (ValueError, 'INVALID_DATA'),
    (OSError, 'LOCAL_IO_ERROR'),
    (RuntimeError, 'UNEXPECTED_ERROR'),
])
def test_failure_categories_never_include_exception_text(exception, code):
    result = failure_details(exception('private-key https://private.example/signed'))
    assert result == {'error_code': code}
    message = failure_message(result, 'submission', 1)
    assert 'private' not in message and '任务编号' in message


def test_http_code_and_request_id_are_allowlisted():
    error = ArkAPIError(403, 'ModelNotOpen', 'request-123')
    assert failure_details(error) == {'error_code': 'PROVIDER_HTTP_ERROR',
        'http_status': 403, 'provider_code': 'ModelNotOpen', 'request_id': 'request-123'}
    unsafe = ArkAPIError(400, 'private secret https://example.com', 'secret\nprivate')
    assert failure_details(unsafe) == {'error_code': 'PROVIDER_HTTP_ERROR', 'http_status': 400}


def test_adapter_keeps_dotted_code_and_safe_request_id_not_body():
    class Response:
        status_code = 400
        headers = {'X-Request-Id': 'fixture-request'}
        def json(self):
            return {'error': {'code': 'InvalidParameter.Content', 'message': 'private-secret'}}
    class Session:
        def request(self, *args, **kwargs):
            return Response()
    provider = DoubaoProvider(api_key='fixture-key', session=Session())
    with pytest.raises(ArkAPIError) as caught:
        provider._json('POST', '/contents/generations/tasks', {})
    assert caught.value.provider_code == 'InvalidParameter.Content'
    assert caught.value.request_id == 'fixture-request'
    assert 'private' not in str(caught.value) and 'fixture-key' not in str(caught.value)


def test_json_decode_error_is_distinguished():
    result = failure_details(requests.exceptions.JSONDecodeError('private-text', 'private-body', 0))
    assert result == {'error_code': 'INVALID_JSON_RESPONSE'}
