"""
真实后端联调验证脚本 (C 端真实集成测试)
启动 A 端真实 FastAPI 业务逻辑，通过真实 Bearer 令牌调用全链路：
1. 图书创建 (POST /api/books)
2. 书籍分类确认 (PATCH /api/books/{id}/classification)
3. 交互问答留痕 (POST /api/runs/{id}/interactions)
4. 交互回读验证 (GET /api/runs/{id}/interactions)
5. 交互触控留痕 (POST /api/runs/{id}/interactions)
6. 笔记草稿生成 (POST /api/books/{id}/notes/generate)
7. 笔记人工修编 (PATCH /api/notes/{id})
8. 主人审核通过 (POST /api/notes/{id}/review)
9. 只读安全分享 (POST /api/notes/{id}/shares)
10. 公开免密读取 (GET /api/shared-notes/{token})
11. 主人撤销分享 (DELETE /api/notes/{id}/shares/{share_id})
12. 撤销后公开读取 (GET /api/shared-notes/{token} -> 404)

并将每一步完整的输入输出保存到 docs/backend-integration-results.json。
"""
from __future__ import annotations

import os
import sys
import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

# 设置测试环境变量
TEST_TOKEN = "c_agent_live_integration_secret_token"
os.environ["APP_USER_TOKENS"] = json.dumps({"agent_c_user": TEST_TOKEN})
os.environ["DATA_ROOT"] = "/tmp/paper_companion_integration_test_data"

# 引入 FastAPI 应用与 TestClient
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.main import app
from app.db import initialize_database, get_connection
from fastapi.testclient import TestClient

def run_integration():
    Path("/tmp/paper_companion_integration_test_data").mkdir(parents=True, exist_ok=True)
    initialize_database()
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {TEST_TOKEN}"}

    results = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "runner": "scripts/run_backend_integration.py",
        "actor": "agent_c_user",
        "steps": []
    }

    # 1. 创建图书
    book_payload = {
        "title": "小狐狸的森林探险记（真实联调）",
        "authorization_ref": "AUTH-2026-COMPETITION-C-001"
    }
    r1 = client.post("/api/books", json=book_payload, headers=headers)
    assert r1.status_code == 201, f"Create book failed: {r1.text}"
    book_data = r1.json()
    book_id = book_data["id"]
    results["steps"].append({
        "step": 1,
        "name": "create_book",
        "method": "POST",
        "url": "/api/books",
        "request": book_payload,
        "status_code": r1.status_code,
        "response": book_data
    })

    # 2. 先执行自动分类 (POST /api/books/{id}/classify)
    r2_auto = client.post(f"/api/books/{book_id}/classify", headers=headers)
    assert r2_auto.status_code == 200, f"Auto classify failed: {r2_auto.text}"
    results["steps"].append({
        "step": 2,
        "name": "auto_classification",
        "method": "POST",
        "url": f"/api/books/{book_id}/classify",
        "status_code": r2_auto.status_code,
        "response": r2_auto.json()
    })

    # 3. 人工分类确认 (经 toBackendBookType 映射的合规值 picture_book)
    cls_payload = {"confirmed_type": "picture_book"}
    r2 = client.patch(f"/api/books/{book_id}/classification", json=cls_payload, headers=headers)
    assert r2.status_code == 200, f"Confirm classification failed: {r2.text}"
    cls_data = r2.json()
    results["steps"].append({
        "step": 3,
        "name": "confirm_classification",
        "method": "PATCH",
        "url": f"/api/books/{book_id}/classification",
        "request": cls_payload,
        "status_code": r2.status_code,
        "response": cls_data
    })

    # 为图书注入有效 Page 与已完成的 Run (模拟分析与渲染前置流程)
    run_id = str(uuid.uuid4())
    page_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO pages(id,book_id,page_no,image_path,sha256,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (page_id, book_id, 1, "/tmp/p1.png", "fake_sha256", "image/png", 1024, now)
        )
        conn.execute(
            "INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at,finished_at) VALUES(?,?,?,?,?,?,?)",
            (run_id, book_id, "SUCCEEDED", "{}", "{}", now, now)
        )
        conn.execute(
            "UPDATE books SET status='ANALYZED', updated_at=? WHERE id=?",
            (now, book_id)
        )

    # 3. 语音问答交互留痕 (POST /api/runs/{run_id}/interactions)
    voice_payload = {
        "interaction_type": "voice",
        "input": {
            "query": "小狐狸戴着什么颜色的围巾？",
            "input_method": "speech",
            "video_ms": 3200
        },
        "output": {
            "producer": "c_interaction_agent",
            "answer": "原书第 1 页写道：“戴着红围巾在森林里唱歌。”",
            "confidence": 0.88,
            "uncertain": False
        },
        "latency_ms": 38
    }
    r3 = client.post(f"/api/runs/{run_id}/interactions", json=voice_payload, headers=headers)
    assert r3.status_code == 201, f"Voice interaction failed: {r3.text}"
    voice_res = r3.json()
    results["steps"].append({
        "step": 3,
        "name": "record_voice_interaction",
        "method": "POST",
        "url": f"/api/runs/{run_id}/interactions",
        "request": voice_payload,
        "status_code": r3.status_code,
        "response": voice_res
    })

    # 4. 回读交互记录 (GET /api/runs/{run_id}/interactions)
    r4 = client.get(f"/api/runs/{run_id}/interactions", headers=headers)
    assert r4.status_code == 200
    list_res1 = r4.json()
    assert len(list_res1) == 1
    assert list_res1[0]["output"]["producer"] == "c_interaction_agent"
    results["steps"].append({
        "step": 4,
        "name": "list_interactions_after_voice",
        "method": "GET",
        "url": f"/api/runs/{run_id}/interactions",
        "status_code": r4.status_code,
        "response": list_res1
    })

    # 5. 触控交互留痕 (POST /api/runs/{run_id}/interactions)
    touch_payload = {
        "interaction_type": "touch",
        "input": {
            "video_ms": 4500,
            "touch_point": {
                "norm_x": 0.52,
                "norm_y": 0.48,
                "video_pixel_x": 998,
                "video_pixel_y": 518,
                "video_width": 1920,
                "video_height": 1080
            },
            "viewport_info": {
                "container_width": 800,
                "container_height": 600,
                "render_width": 800,
                "render_height": 450,
                "offset_x": 0,
                "offset_y": 75,
                "is_letterbox": True
            }
        },
        "output": {
            "producer": "c_interaction_agent",
            "target_name": None,
            "explanation": "已记录画面坐标 (0.52, 0.48)，当前未配置视觉模型服务，如实返回 uncertain",
            "confidence": None,
            "uncertain": True,
            "evidence": []
        },
        "latency_ms": 15
    }
    r5 = client.post(f"/api/runs/{run_id}/interactions", json=touch_payload, headers=headers)
    assert r5.status_code == 201, f"Touch interaction failed: {r5.text}"
    touch_res = r5.json()
    results["steps"].append({
        "step": 5,
        "name": "record_touch_interaction",
        "method": "POST",
        "url": f"/api/runs/{run_id}/interactions",
        "request": touch_payload,
        "status_code": r5.status_code,
        "response": touch_res
    })

    # 再次回读，验证包含 2 条
    r5_list = client.get(f"/api/runs/{run_id}/interactions", headers=headers)
    assert r5_list.status_code == 200
    assert len(r5_list.json()) == 2

    # 6. 笔记草稿生成 (POST /api/books/{book_id}/notes/generate)
    note_gen_payload = {"note_template": "picture_book_discovery"}
    r6 = client.post(f"/api/books/{book_id}/notes/generate", json=note_gen_payload, headers=headers)
    assert r6.status_code == 201, f"Note generate failed: {r6.text}"
    note_data = r6.json()
    note_id = note_data["id"]
    results["steps"].append({
        "step": 6,
        "name": "generate_note_draft",
        "method": "POST",
        "url": f"/api/books/{book_id}/notes/generate",
        "request": note_gen_payload,
        "status_code": r6.status_code,
        "response": note_data
    })

    # 7. 笔记修编 (PATCH /api/notes/{note_id})，补充有效页码来源与摘要以解除占位状态
    patch_payload = {
        "content": {
            "title": "小狐狸的探险启迪",
            "summary": "小狐狸戴红围巾勇敢出门，迷路后在啄木鸟和大雁的指引下平安回到树洞，亲子阅读重点关注安全与关爱。",
            "sources": [{"page_no": 1, "quote": "从前有一只活泼的小狐狸皮皮..."}]
        }
    }
    r7 = client.patch(f"/api/notes/{note_id}", json=patch_payload, headers=headers)
    assert r7.status_code == 200, f"Patch note failed: {r7.text}"
    patched_data = r7.json()
    results["steps"].append({
        "step": 7,
        "name": "patch_note_content",
        "method": "PATCH",
        "url": f"/api/notes/{note_id}",
        "request": patch_payload,
        "status_code": r7.status_code,
        "response": patched_data
    })

    # 8. 主人审核通过 (POST /api/notes/{note_id}/review)
    review_payload = {"action": "approve"}
    r8 = client.post(f"/api/notes/{note_id}/review", json=review_payload, headers=headers)
    assert r8.status_code == 200, f"Review note failed: {r8.text}"
    reviewed_data = r8.json()
    assert reviewed_data["status"] == "PRIVATE"
    results["steps"].append({
        "step": 8,
        "name": "review_note_approve",
        "method": "POST",
        "url": f"/api/notes/{note_id}/review",
        "request": review_payload,
        "status_code": r8.status_code,
        "response": reviewed_data
    })

    # 9. 创建限时只读分享 (POST /api/notes/{note_id}/shares)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    share_payload = {
        "share_mode": "link",
        "expires_at": expires_at
    }
    r9 = client.post(f"/api/notes/{note_id}/shares", json=share_payload, headers=headers)
    assert r9.status_code == 201, f"Create share failed: {r9.text}"
    share_data = r9.json()
    share_id = share_data["id"]
    share_token = share_data["token"]
    assert share_token is not None, "Link share must return plaintext token"
    results["steps"].append({
        "step": 9,
        "name": "create_note_share",
        "method": "POST",
        "url": f"/api/notes/{note_id}/shares",
        "request": share_payload,
        "status_code": r9.status_code,
        "response": share_data
    })

    # 10. 公开免密读取 (GET /api/shared-notes/{token})
    # 注意：公开接口不带 Authorization 头
    r10 = client.get(f"/api/shared-notes/{share_token}")
    assert r10.status_code == 200, f"Public read share failed: {r10.text}"
    public_note_data = r10.json()
    assert public_note_data["id"] == note_id
    results["steps"].append({
        "step": 10,
        "name": "public_read_shared_note_success",
        "method": "GET",
        "url": f"/api/shared-notes/{share_token}",
        "auth_header": None,
        "status_code": r10.status_code,
        "response": public_note_data
    })

    # 11. 主人撤销分享 (DELETE /api/notes/{note_id}/shares/{share_id})
    r11 = client.delete(f"/api/notes/{note_id}/shares/{share_id}", headers=headers)
    assert r11.status_code == 204, f"Revoke share failed: {r11.text}"
    results["steps"].append({
        "step": 11,
        "name": "revoke_share",
        "method": "DELETE",
        "url": f"/api/notes/{note_id}/shares/{share_id}",
        "status_code": r11.status_code,
        "response": None
    })

    # 12. 撤销后再次公开读取，验证必须返回 404 (失效)
    r12 = client.get(f"/api/shared-notes/{share_token}")
    assert r12.status_code == 404, f"Revoked token must return 404, got {r12.status_code}"
    results["steps"].append({
        "step": 12,
        "name": "public_read_shared_note_after_revoke",
        "method": "GET",
        "url": f"/api/shared-notes/{share_token}",
        "status_code": r12.status_code,
        "response": r12.json()
    })

    # 写入 docs/backend-integration-results.json
    out_path = Path(__file__).resolve().parent.parent / "docs" / "backend-integration-results.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"Backend integration test completed successfully! Results written to {out_path}")

if __name__ == "__main__":
    run_integration()
