"""Launch with the selected base Python, reusing only this project's dependencies."""
import argparse
from pathlib import Path
import runpy
import site
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1] / 'backend'
    environment = backend / '.venv'
    config = {key.strip(): value.strip() for line in (environment / 'pyvenv.cfg').read_text().splitlines()
              if '=' in line for key, value in [line.split('=', 1)]}
    version = config.get('version', '').split('.')[:2]
    if version != [str(sys.version_info.major), str(sys.version_info.minor)]:
        raise SystemExit('Configured Python must match the project Python major/minor version.')
    dependencies = environment / 'Lib' / 'site-packages'
    if not dependencies.is_dir():
        raise SystemExit('Project dependencies are missing; run the desktop launcher first.')
    site.addsitedir(str(dependencies))
    sys.path.insert(0, str(backend))
    if args.check:
        import fastapi, uvicorn, pymongo, PIL, argon2, requests
        from app.services.local_speech import capabilities
        from app.services.video_runtime import ffmpeg_path
        from app.ai.doubao_settings import vision_settings
        import json
        key, model = vision_settings()
        print(json.dumps({'speech': capabilities(), 'ffmpeg_available': bool(ffmpeg_path()),
                          'vision_configured': bool(key and model)}, ensure_ascii=True))
        return
    sys.argv = ['uvicorn', 'app.main:app', '--host', args.host, '--port', str(args.port)]
    runpy.run_module('uvicorn', run_name='__main__')


if __name__ == '__main__':
    main()
