"""Software-only publication checks with invented, split sensitive markers."""
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('publication_check', Path(__file__).resolve().parents[2] / 'scripts/check-publication.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


@pytest.mark.parametrize('name', ['data/book.json', 'docs/screenshots/a.png', 'project-assets/report.md',
    'backend/.venv/secret.py', 'backend/tests/private.db', 'models/weights.gguf',
    'frontend-wonderland/dist/app.js', 'frontend-wonderland/public/user.mp4',
    'backend/uploads/book.txt', 'docs/private-report.md', '.env', '../outside.py'])
def test_publication_refuses_non_software(name):
    assert check.inspect_file(name, b'not for publication')


@pytest.mark.parametrize('name', ['backend/app/main.py', 'scripts/setup-local-qwen.py',
    'frontend-wonderland/src/pages/InteractiveReaderPage.tsx', 'mobile-tablet/src/App.tsx',
    'docs/public-release/data-boundary.md', '.env.example'])
def test_publication_accepts_reviewable_source(name):
    assert not check.inspect_file(name, b'# software source\n')


def test_rejects_binary_tampering_and_symlinks():
    assert check.inspect_file('frontend-wonderland/public/art/reading-owl.png', b'user image')
    assert check.inspect_file('backend/app/main.py', b'outside', '120000')
    assert check.inspect_file('backend/app/main.py', b'\xff\x00')


@pytest.mark.parametrize('content', [
    'gh' + 'p_' + 'A' * 30,
    'mongodb://' + 'testuser:testpass@remote.invalid/db',
    'C:' + '\\Users\\' + 'private-test-person\\book.txt',
    'wx' + 'id_' + 'synthetic-marker',
    '139' + '12345678',
])
def test_reports_location_without_echoing_sensitive_value(content):
    issues = check.inspect_file('backend/app/example.py', content.encode())
    assert issues and all(content not in issue for issue in issues)
