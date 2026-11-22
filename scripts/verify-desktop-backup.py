"""Verify private backup hashes and restore into isolated temporary locations only."""
from __future__ import annotations
from contextlib import closing
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import uuid
import zipfile
import os


def verify(folder: Path, mongo_restore_test: bool = False):
    from bson import decode_file_iter, json_util
    from pymongo import MongoClient
    folder = folder.resolve()
    if not (folder / "BACKUP-COMPLETE").is_file() or (folder / "BACKUP-INCOMPLETE").exists():
        raise ValueError("Not a completed backup")
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    for rel, item in manifest["files"].items():
        f = (folder / rel).resolve()
        if not f.is_relative_to(folder):
            raise ValueError("Invalid manifest path")
        h = hashlib.sha256()
        with f.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(chunk)
        if f.stat().st_size != item["bytes"] or h.hexdigest() != item["sha256"]:
            raise ValueError("Backup checksum mismatch: " + rel)
    result = {"checksums": len(manifest["files"]), "source_files": 0, "sqlite_restores": [], "mongo_restore": "not requested"}
    with tempfile.TemporaryDirectory(prefix="verify-", dir=folder.parent) as tmp:
        dest = Path(tmp)
        with zipfile.ZipFile(folder / "desktop-source.zip") as z:
            if z.testzip() is not None:
                raise ValueError("Corrupt source archive")
            expected = json.loads((folder / "source-hashes.json").read_text(encoding="utf-8"))
            for name in z.namelist():
                if name.startswith(("/", "\\")) or ".." in Path(name).parts or not (dest / name).resolve().is_relative_to(dest):
                    raise ValueError("Unsafe archive path")
                if hashlib.sha256(z.read(name)).hexdigest() != expected[name]:
                    raise ValueError("Source hash mismatch")
            z.extractall(dest / "source")
            result["source_files"] = len(z.namelist())
        for info in manifest["sqlite"]:
            db = (folder / info["file"]).resolve()
            if not db.is_relative_to(folder):
                raise ValueError("Invalid SQLite path")
            restored = dest / (str(len(result["sqlite_restores"])) + ".db")
            with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as src, closing(sqlite3.connect(restored)) as target:
                src.backup(target)
                if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("SQLite restore failed")
            result["sqlite_restores"].append(info["file"])
        subprocess.run(["git", "init", "-q", str(dest / "git-check")], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(dest / "git-check"), "bundle", "verify", str(folder / "git-state/history.bundle")], check=True, capture_output=True)
    if mongo_restore_test:
        client = MongoClient(os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017"), serverSelectionTimeoutMS=5000)
        name = "paper_backup_verify_" + uuid.uuid4().hex
        if name in client.list_database_names():
            raise RuntimeError("Verification DB unexpectedly exists")
        test_db = client[name]
        counts = []
        created = False
        try:
            for collection in manifest["mongo"]["collections"]:
                cname = collection["name"]
                if not cname.replace("_", "").isalnum():
                    raise ValueError("Invalid collection name")
                meta = json_util.loads((folder / "mongo" / (cname + ".metadata.json")).read_text(encoding="utf-8"))
                test_db.create_collection(cname, **meta["options"])
                created = True
                with (folder / "mongo" / (cname + ".bson")).open("rb") as f:
                    batch = []
                    for document in decode_file_iter(f):
                        batch.append(document)
                        if len(batch) >= 500:
                            test_db[cname].insert_many(batch)
                            batch = []
                    if batch:
                        test_db[cname].insert_many(batch)
                restored_count = test_db[cname].count_documents({})
                if restored_count != collection["count"]:
                    raise ValueError("Mongo restore count mismatch")
                for index in meta["indexes"]:
                    if index["name"] != "_id_":
                        opts = {k: v for k, v in index.items() if k not in {"key", "v", "ns"}}
                        test_db[cname].create_index(list(index["key"].items()), **opts)
                counts.append({"name": cname, "restored_count": restored_count, "indexes": len(list(test_db[cname].list_indexes()))})
            result["mongo_restore"] = counts
        finally:
            # Only this random, initially absent verification database can be removed.
            if created and name.startswith("paper_backup_verify_") and len(name) == len("paper_backup_verify_") + 32:
                client.drop_database(name)
            client.close()
    (folder / "verification-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--mongo-restore-test", action="store_true")
    args = parser.parse_args()
    print(json.dumps(verify(args.folder, args.mongo_restore_test), ensure_ascii=False, indent=2))
