"""Private desktop snapshot; reads production data, never restores over it.

Run with backend/.venv/Scripts/python.exe. Dependencies are deliberately omitted;
they can be reinstalled from the lockfile and requirements. Mobile is out of scope.
"""
from __future__ import annotations
from contextlib import closing

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
from datetime import datetime
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", ".venv", "__pycache__", ".git", ".pytest_cache"}
SOURCE_DIRS = {"backend", "frontend-wonderland", "scripts", "docs", "tests", ".github", "汇报材料"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args], stderr=subprocess.PIPE)


def source_files():
    for p in ROOT.iterdir():
        if p.is_file() and p.name != ".git" and not p.name.startswith(".tmp"):
            yield p
        elif p.name in SOURCE_DIRS and p.is_dir():
            for base, dirs, files in os.walk(p, followlinks=False):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (Path(base) / d).is_junction()]
                for name in files:
                    f = Path(base) / name
                    if not f.is_symlink() and not name.endswith((".pyc", ".tsbuildinfo")):
                        yield f


def make_backup(parent: Path) -> Path:
    # Fail rather than silently producing a snapshot without the accounts database.
    from bson import BSON, decode_file_iter, json_util
    from pymongo import MongoClient
    parent = parent.resolve()
    if parent == ROOT or ROOT in parent.parents:
        raise ValueError("Choose a backup folder outside the source project")
    parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(parent).free < 1024 ** 3:
        raise RuntimeError("At least 1 GB free space required")
    out = parent / datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir()  # Never overwrite a previous backup.
    try:
        # A private bundle preserves committed history; patches + index preserve local edits/staging.
        gd = out / "git-state"
        gd.mkdir()
        (gd / "status.txt").write_bytes(git("-c", "core.quotepath=false", "status", "--short"))
        (gd / "head.txt").write_bytes(git("rev-parse", "HEAD"))
        (gd / "branch.txt").write_bytes(git("branch", "--show-current"))
        (gd / "staged.patch").write_bytes(git("diff", "--binary", "--cached"))
        (gd / "unstaged.patch").write_bytes(git("diff", "--binary"))
        index = Path(git("rev-parse", "--git-path", "index").decode().strip())
        if not index.is_absolute():
            index = ROOT / index
        shutil.copy2(index, gd / "index.original")
        git("bundle", "create", str(gd / "history.bundle"), "--all")
        git("bundle", "verify", str(gd / "history.bundle"))

        source_hashes = {}
        with zipfile.ZipFile(out / "desktop-source.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for f in sorted(source_files()):
                rel = f.relative_to(ROOT).as_posix()
                # Hash exactly the archived bytes (not a second, potentially changed read).
                data = f.read_bytes()
                source_hashes[rel] = hashlib.sha256(data).hexdigest()
                z.writestr(rel, data)
        (out / "source-hashes.json").write_text(json.dumps(source_hashes, ensure_ascii=False, indent=2), encoding="utf-8")

        # SQLite's backup API also captures committed WAL pages safely.
        source_data = Path(os.environ.get("DATA_ROOT", ROOT / "data")).resolve()
        shutil.copytree(source_data, out / "data", ignore=shutil.ignore_patterns("*.db", "*.db-wal", "*.db-shm", "*.sqlite", "*.sqlite-wal", "*.sqlite-shm", "*.sqlite3", "*.sqlite3-wal", "*.sqlite3-shm"))
        databases = list(source_data.rglob("*.db")) + list(source_data.rglob("*.sqlite")) + list(source_data.rglob("*.sqlite3"))
        primary = Path(os.environ.get("DATABASE_PATH", ROOT / "data/paper_companion.db")).resolve()
        if primary not in databases:
            databases.append(primary)
        sqlite_info = []
        for db in databases:
            rel = db.relative_to(source_data) if db.is_relative_to(source_data) else Path("external-business") / db.name
            target = out / "data" / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as src, closing(sqlite3.connect(target)) as dest:
                src.backup(dest)
                dest.execute("PRAGMA journal_mode=DELETE")
                result = dest.execute("PRAGMA integrity_check").fetchone()[0]
                if result != "ok":
                    raise RuntimeError("SQLite integrity check failed")
                tables = [r[0] for r in dest.execute("SELECT name FROM sqlite_master WHERE type='table'")]
                sqlite_info.append({"file": target.relative_to(out).as_posix(), "integrity": result, "tables": len(tables)})

        # Logical BSON export preserves BSON types and indexes without copying live WiredTiger files.
        mongo = MongoClient(os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017"), serverSelectionTimeoutMS=5000)
        db = mongo[os.environ.get("MONGODB_DATABASE", "paper_companion")]
        mongo.admin.command("ping")
        md = out / "mongo"
        md.mkdir()
        mongo_info = {"database": db.name, "collections": []}
        try:
            before = sorted(db.list_collection_names())
            for name in before:
                if not name.replace("_", "").isalnum():
                    raise ValueError("Unsupported Mongo collection filename")
                collection = db[name]
                collection_meta = {"name": name, "options": collection.options(), "indexes": list(collection.list_indexes())}
                before_hash = hashlib.sha256()
                count = 0
                with (md / (name + ".bson")).open("wb") as f:
                    for document in collection.find({}).sort("_id", 1):
                        encoded = BSON.encode(document)
                        f.write(encoded)
                        before_hash.update(encoded)
                        count += 1
                after_hash = hashlib.sha256()
                for document in collection.find({}).sort("_id", 1):
                    after_hash.update(BSON.encode(document))
                if before_hash.digest() != after_hash.digest():
                    raise RuntimeError("Mongo changed during backup; close clients and retry")
                with (md / (name + ".bson")).open("rb") as f:
                    if sum(1 for _ in decode_file_iter(f)) != count:
                        raise RuntimeError("BSON verification failed")
                collection_meta["count"] = count
                (md / (name + ".metadata.json")).write_text(json_util.dumps(collection_meta, indent=2), encoding="utf-8")
                mongo_info["collections"].append({"name": name, "count": count})
            if before != sorted(db.list_collection_names()):
                raise RuntimeError("Mongo collection set changed during backup")
        finally:
            mongo.close()
        (md / "inventory.json").write_text(json.dumps(mongo_info, indent=2), encoding="utf-8")

        credentials = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "PaperCompanion/Doubao"
        if credentials.exists():
            shutil.copytree(credentials, out / "private-local-settings/Doubao")
        (out / "PRIVATE-READ-FIRST.txt").write_text(
            "PRIVATE LOCAL BACKUP. Contains account password hashes, sessions and reading data. Do not upload or share.\n"
            "desktop-source.zip excludes mobile-tablet, dependencies, caches and test scratch folders.\n"
            "data contains SQLite API snapshots and media; mongo contains BSON logical export plus index metadata.\n"
            "Git history.bundle + patches + original index preserve committed and local work.\n"
            "DPAPI settings only work for the original Windows user/computer; set keys again on another PC.\n"
            "Run scripts/verify-desktop-backup.py against this folder to verify isolated copies.\n"
            "No app-wide atomic snapshot guarantee: do not upload/edit while taking a backup.\n"
            "Restore first into NEW paths/databases; never overwrite production without checking.\n", encoding="utf-8")
        manifest = {"created": datetime.now().astimezone().isoformat(), "project": str(ROOT), "sqlite": sqlite_info,
                    "mongo": mongo_info, "excluded": ["mobile-tablet", "node_modules", ".venv", "test scratch folders"],
                    "files": {}}
        for f in sorted(out.rglob("*")):
            if f.is_file():
                manifest["files"][f.relative_to(out).as_posix()] = {"bytes": f.stat().st_size, "sha256": sha256(f)}
        (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "BACKUP-COMPLETE").write_text("Snapshot completed; see verification report separately.\n", encoding="utf-8")
        return out
    except Exception:
        (out / "BACKUP-INCOMPLETE").write_text("Backup failed. Do not use as a complete restore point.\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    print(make_backup(args.destination))
