"""Read the owner's saved Windows credential without exposing it to the browser.

Environment variables take precedence. The optional local fallback is the same
current-user DPAPI store used by the earlier Doubao desktop trials; no plaintext
credential is written to the repository or logs.
"""
import ctypes
import json
import os
from pathlib import Path
from ctypes import wintypes


def _unprotect(raw: bytes) -> str:
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]

    buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = Blob(len(raw), buffer)
    result = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ValueError('Local credential unavailable')
    try:
        return ctypes.string_at(result.data, result.size).decode('utf-16-le').strip()
    finally:
        # Erase the unmanaged plaintext before releasing the Windows buffer.
        ctypes.memset(result.data, 0, result.size)
        kernel.LocalFree(result.data)


def video_settings() -> tuple[str, str]:
    key = os.getenv('ARK_API_KEY', '').strip()
    model = os.getenv('DOUBAO_VIDEO_MODEL', '').strip()
    if os.name != 'nt' or (key and model):
        return key, model
    folder = Path(os.getenv('LOCALAPPDATA') or Path.home() / 'AppData/Local') / 'PaperCompanion/Doubao'
    try:
        if not model:
            config = json.loads((folder / 'models.json').read_text(encoding='utf-8-sig'))
            value = config.get('video_model')
            model = value.strip() if isinstance(value, str) else ''
        if not key:
            encrypted = (folder / 'ark-key.dpapi').read_text(encoding='utf-8-sig').strip()
            if len(encrypted) <= 65536:
                key = _unprotect(bytes.fromhex(encrypted))
    except (OSError, ValueError, TypeError, AttributeError):
        # Only configuration presence is disclosed to callers, never file contents.
        pass
    return key, model


def vision_settings() -> tuple[str, str]:
    """视觉理解必须独立配置模型，不把作图/视频模型当成看图模型。"""
    key, _ = video_settings()
    model = os.getenv('DOUBAO_VISION_MODEL', '').strip()
    if not model and os.name == 'nt':
        folder = Path(os.getenv('LOCALAPPDATA') or Path.home() / 'AppData/Local') / 'PaperCompanion/Doubao'
        try:
            config = json.loads((folder / 'models.json').read_text(encoding='utf-8-sig'))
            value = config.get('vision_model')
            model = value.strip() if isinstance(value, str) else ''
        except (OSError, ValueError, AttributeError):
            pass
    return key, model
