"""Local recovery receipt: no credentials, prompts, responses or media URLs."""
import hashlib
import json
import os
import re
from pathlib import Path


def request_hash(request):
    raw = json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def receipt_path(root, job_id, page_no):
    if not re.fullmatch(r'[A-Za-z0-9-]{1,80}', job_id) or type(page_no) is not int or page_no < 1:
        raise ValueError('Invalid receipt identity')
    return Path(root) / f'video-submission-{job_id}-{page_no}.json'


def write(root, run_id, job_id, page_no, request, task_id):
    if not isinstance(task_id, str) or not re.fullmatch(r'cgt-[A-Za-z0-9-]+', task_id):
        raise ValueError('Invalid task identity')
    target = receipt_path(root, job_id, page_no)
    temporary = target.with_suffix('.json.part')
    record = {'version': 1, 'run_id': run_id, 'job_id': job_id, 'page_no': page_no,
              'request_hash': request_hash(request), 'task_id': task_id}
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(record, stream, ensure_ascii=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, target)


def read(root, run_id, job_id, page_no, request):
    path = receipt_path(root, job_id, page_no)
    if not path.is_file():
        return None
    if path.stat().st_size > 4096:
        raise ValueError('Invalid receipt size')
    record = json.loads(path.read_text(encoding='utf-8'))
    expected = {'version': 1, 'run_id': run_id, 'job_id': job_id, 'page_no': page_no,
                'request_hash': request_hash(request)}
    if not isinstance(record, dict) or any(record.get(k) != v for k, v in expected.items()):
        raise ValueError('Receipt identity mismatch')
    task_id = record.get('task_id')
    if not isinstance(task_id, str) or not re.fullmatch(r'cgt-[A-Za-z0-9-]+', task_id):
        raise ValueError('Invalid receipt task')
    return task_id
