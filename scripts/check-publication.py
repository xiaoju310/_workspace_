"""Fail closed on non-software files in an explicit Git snapshot; no network access."""
from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
from pathlib import PurePosixPath

ROOT_FILES = {'.env.example', '.gitattributes', '.gitignore', 'README.md', 'pyproject.toml', '交付说明.md'}
ROOT_LAUNCHERS = {
    f'启动{name}{suffix}.cmd'
    for name in ('开卷有灵', '纸书智伴')
    for suffix in ('', '-局域网共享', '-Tailscale共享')
}
PUBLIC_DOCS = {
    'docs/协作与审核规则.md', 'docs/licenses/react-MIT.txt',
    'docs/public-release/software-update.md', 'docs/public-release/data-boundary.md',
    'docs/public-release/third-party-models.md',
}
# Only reviewed, non-user binary assets may enter the source snapshot.
BINARY_ASSETS = {
    'frontend-wonderland/public/art/reading-owl.png': '27d24a9221c6d91ad56f86750ae9a91e98d934ace794dbc978c53a81d6dc3aee',
    'backend/tests/fixtures/password-protected.pdf': 'cb2316e9cdec32bdbbc0187ce60acbcde1b3065e666cb59591d6d8e9c3caeb00',
}
SOURCE_SUFFIXES = {
    '.py', '.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.css', '.html', '.svg',
    '.md', '.txt', '.ps1', '.cmd', '.toml', '.gradle', '.xml', '.java',
}
FORBIDDEN_PARTS = {
    'data', 'project-assets', 'private-backups', 'local-only', 'uploads', 'runs',
    'backups', 'logs', 'models', 'ollama', 'node_modules', 'dist', '.venv',
    '__pycache__', '.pytest_cache', 'test-results', 'test-books',
}
PATTERNS = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----'),
    'github-token': re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,})'),
    'provider-token': re.compile(r'\bsk-[A-Za-z0-9_-]{20,}\b'),
    'database-credential': re.compile(r'mongodb(?:\+srv)?://[^\s/@]+:[^\s/@]+@'),
    'personal-home-path': re.compile(r'[A-Z]:[/\\]Users[/\\](?!Public\b|Default\b|<|\$)[^/\\\s"\x27]+', re.I),
    'wechat-id': re.compile(r'wxid_[A-Za-z0-9_-]+'),
    'phone-number': re.compile(r'(?<![\w\d])1[3-9]\d{9}(?![\w\d])'),
}


def path_allowed(name: str) -> bool:
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        return False
    if any(part.lower() in FORBIDDEN_PARTS or part.startswith('.tmp') for part in path.parts):
        return False
    if name in ROOT_FILES | ROOT_LAUNCHERS | PUBLIC_DOCS or name in BINARY_ASSETS:
        return True
    if name.startswith('.github/'):
        return name in {'.github/CODEOWNERS', '.github/pull_request_template.md'}
    if not name.startswith(('backend/', 'frontend-wonderland/', 'mobile-tablet/', 'scripts/', 'tests/')):
        return False
    return path.name == '.gitignore' or path.suffix.lower() in SOURCE_SUFFIXES


def inspect_file(name: str, data: bytes, mode: str = '100644') -> list[str]:
    if mode not in {'100644', '100755'}:
        return [f'{name}: links and submodules are not permitted in a publication snapshot']
    if not path_allowed(name):
        return [f'{name}: not an approved software source path']
    if name in BINARY_ASSETS:
        if hashlib.sha256(data).hexdigest() != BINARY_ASSETS[name]:
            return [f'{name}: reviewed binary checksum changed; review it before publishing']
        return []
    if len(data) > 2 * 1024 * 1024:
        return [f'{name}: unexpected large source file']
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return [f'{name}: unapproved binary or non-UTF-8 source']
    if '\x00' in text:
        return [f'{name}: unexpected binary content']
    errors = []
    for label, pattern in PATTERNS.items():
        for number, line in enumerate(text.splitlines(), 1):
            if pattern.search(line):
                # Never echo a secret or a user's original text to console logs.
                errors.append(f'{name}:{number}: possible {label}; review locally')
    if re.search(r'data:(?:image|audio|video)/[^\s;]+;base64,[A-Za-z0-9+/=]{4096,}', text):
        errors.append(f'{name}: unexpected embedded media; review locally')
    return errors


def snapshot(revision: str | None):
    if revision is None:
        raw = subprocess.check_output(['git', 'ls-files', '--stage', '-z'])
        for row in raw.split(b'\0'):
            if not row:
                continue
            metadata, name = row.split(b'\t', 1)
            mode, oid, stage = metadata.decode().split()
            if stage != '0':
                raise ValueError('Resolve merge conflicts before publication')
            yield name.decode('utf-8'), mode, oid
    else:
        raw = subprocess.check_output(['git', 'ls-tree', '-r', '-z', revision])
        for row in raw.split(b'\0'):
            if not row:
                continue
            metadata, name = row.split(b'\t', 1)
            mode, kind, oid = metadata.decode().split()
            yield name.decode('utf-8'), mode, oid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--staged', action='store_true', help='check the entire index, not just changed files')
    group.add_argument('--revision', help='check the full tree of a committed revision')
    args = parser.parse_args()
    errors = []
    entries = list(snapshot(args.revision))
    for name, mode, oid in entries:
        data = subprocess.check_output(['git', 'cat-file', 'blob', oid]) if mode != '160000' else b''
        errors.extend(inspect_file(name, data, mode))
    for error in errors:
        print(error)
    print(f'Publication check: {len(entries)} files; {len(errors)} issues.')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
