"""Allowlisted video failure details. Never serialize exception text or requests."""
import sqlite3
import requests
from ..ai.video_doubao import ArkAPIError


def failure_details(exc):
    if isinstance(exc, ArkAPIError):
        result = {'error_code': 'PROVIDER_HTTP_ERROR', 'http_status': exc.status}
        if exc.provider_code:
            result['provider_code'] = exc.provider_code
        if exc.request_id:
            result['request_id'] = exc.request_id
        return result
    for kind, code in (
        (requests.exceptions.SSLError, 'TLS_ERROR'),
        (requests.exceptions.ProxyError, 'PROXY_ERROR'),
        (requests.ConnectTimeout, 'CONNECT_TIMEOUT'),
        (requests.ReadTimeout, 'READ_TIMEOUT'),
        (requests.Timeout, 'TIMEOUT'),
        (requests.ConnectionError, 'CONNECTION_ERROR'),
        (requests.exceptions.JSONDecodeError, 'INVALID_JSON_RESPONSE'),
        (requests.RequestException, 'REQUEST_ERROR'),
        (sqlite3.Error, 'DATABASE_ERROR'),
        (ValueError, 'INVALID_DATA'),
        (OSError, 'LOCAL_IO_ERROR'),
    ):
        if isinstance(exc, kind):
            return {'error_code': code}
    return {'error_code': 'UNEXPECTED_ERROR'}


def failure_message(details, phase, page_no):
    phases = {'persist_submission': '保存云端任务编号', 'submission': '提交云端视频任务', 'poll': '查询云端任务',
              'download': '下载视频', 'probe': '检查视频', 'compose': '合成整书视频',
              'save': '保存视频结果', 'narration': '生成旁白',
              'provider_prepare': '准备视频服务', 'prepare_page': '准备书页'}
    location = ('第 ' + str(page_no) + ' 页：') if page_no is not None else ''
    message = location + phases.get(phase, '处理视频') + '失败（' + details['error_code']
    if 'http_status' in details:
        message += '，HTTP ' + str(details['http_status'])
    if 'provider_code' in details:
        message += '，' + details['provider_code']
    message += '）。'
    if phase == 'submission':
        message += '未取得任务编号，提交结果仍需核对；不会自动重复提交。'
    elif phase == 'persist_submission':
        message += '云端已返回任务编号；请恢复原任务以核验本地凭据，不要重新生成。'
    else:
        message += '已保存的任务编号和片段不会重复提交。'
    if details.get('request_id'):
        message += '请求编号：' + details['request_id']
    return message
