"""Explicit one-time setup of portable Ollama + local Qwen3-VL (Windows x64).
Run with Python: scripts/setup-local-qwen.py --install-dir D:\\Tools\\PaperCompanion
Downloads official release and verifies its published SHA256. No cloud inference.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import zipfile


def get(url, timeout=90):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'PaperCompanion-local-setup'}), timeout=timeout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install-dir', type=Path, default=Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'PaperCompanion' / 'local-model')
    args = parser.parse_args()
    if os.name != 'nt':
        raise SystemExit('This installer is for Windows x64 only.')
    root = args.install_dir.expanduser().resolve()
    runtime = root / 'ollama'; models = root / 'models'
    runtime.mkdir(parents=True, exist_ok=True); models.mkdir(parents=True, exist_ok=True)
    if not (runtime / 'ollama.exe').is_file():
        with get('https://api.github.com/repos/ollama/ollama/releases/latest') as source:
            release = json.load(source)
        asset = next(a for a in release['assets'] if a['name'] == 'ollama-windows-amd64.zip')
        checks = next(a for a in release['assets'] if a['name'] == 'sha256sum.txt')
        with get(checks['browser_download_url']) as source:
            lines = source.read().decode().splitlines()
        expected = next(line.split()[0] for line in lines if line.split()[-1].lstrip('*').removeprefix('./') == asset['name'])
        archive = runtime / asset['name']
        print('Downloading official Ollama', release['tag_name'], flush=True)
        with get(asset['browser_download_url'], 120) as source, archive.open('wb') as dest:
            count = 0; last = time.monotonic()
            while chunk := source.read(4*1024*1024):
                dest.write(chunk); count += len(chunk)
                if time.monotonic()-last > 20:
                    print('Downloaded', round(count/1024**2), 'MiB', flush=True); last=time.monotonic()
        with archive.open('rb') as source:
            actual = hashlib.file_digest(source, 'sha256').hexdigest()
        if actual != expected:
            raise SystemExit('SHA256 verification failed; nothing was extracted.')
        with zipfile.ZipFile(archive) as source:
            if any(not (runtime / member.filename).resolve().is_relative_to(runtime) for member in source.infolist()):
                raise SystemExit('Unsafe archive member; extraction cancelled.')
            source.extractall(runtime)
        (runtime / 'installed-release.json').write_text(json.dumps({'release':release['tag_name'],'sha256':actual}),encoding='utf-8')
    env = dict(os.environ, OLLAMA_HOST='127.0.0.1:11434', OLLAMA_MODELS=str(models), OLLAMA_NO_CLOUD='1',
        OLLAMA_NUM_PARALLEL='1', OLLAMA_MAX_LOADED_MODELS='1', OLLAMA_CONTEXT_LENGTH='4096', OLLAMA_FLASH_ATTENTION='1')
    config_dir = Path(os.environ['LOCALAPPDATA']) / 'PaperCompanion'
    config_dir.mkdir(parents=True,exist_ok=True)
    # Never reuse an unrelated model server: its model directory and cloud policy are unknown.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open('http://127.0.0.1:11434/api/tags', timeout=2):
            occupied=True
    except OSError:
        occupied=False
    if occupied:
        existing=config_dir/'local-vision.json'
        config=json.loads(existing.read_text(encoding='utf-8-sig')) if existing.is_file() else {}
        if config.get('executable') != str(runtime/'ollama.exe') or config.get('models_path') != str(models):
            raise SystemExit('Port 11434 is occupied by another model server. Stop it before continuing.')
    else:
        with (config_dir/'local-vision-out.log').open('ab') as out, (config_dir/'local-vision-error.log').open('ab') as err:
            subprocess.Popen([str(runtime/'ollama.exe'),'serve'],env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        for _ in range(30):
            try:
                with opener.open('http://127.0.0.1:11434/api/tags',timeout=2):break
            except OSError:time.sleep(1)
        else:raise SystemExit('Local Ollama did not start. See local-vision-error.log.')
    # Download explicitly requested local model weights, not a cloud model.
    subprocess.run([str(runtime/'ollama.exe'),'pull','qwen3-vl:4b'],env=env,check=True)
    (config_dir/'local-vision.json').write_text(json.dumps({'enabled':True,'model':'qwen3-vl:4b',
        'base_url':'http://127.0.0.1:11434','executable':str(runtime/'ollama.exe'),'models_path':str(models)},indent=2),encoding='utf-8')
    print('Local Qwen installed. Restart PaperCompanion and enable local touch recognition.',flush=True)


if __name__ == '__main__':
    main()
