#!/usr/bin/env bash
# 真实联调门禁：启动真实 FastAPI（临时数据库），用真实前端代码经 HTTP 跑主流程。
set -u
cd "$(dirname "$0")/.."
PY=backend/.venv/bin/python
if [ ! -x "$PY" ]; then echo "未验证：找不到 $PY，无法启动真实后端。"; exit 1; fi
TMP=$(mktemp -d); PORT=${LIVE_PORT:-8766}; TOKEN=live-check-token
( cd backend && APP_USER_TOKENS="{\"live_check\":\"$TOKEN\"}" DATABASE_PATH="$TMP/live.db" DATA_ROOT="$TMP" exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --log-level warning ) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 1 40); do curl -sf -m1 "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.25; done
curl -sf -m1 "http://127.0.0.1:$PORT/health" >/dev/null || { echo "后端未能启动"; exit 1; }
cd frontend
LIVE_BACKEND_URL="http://127.0.0.1:$PORT" LIVE_TOKEN="$TOKEN" LIVE_DATABASE_PATH="$TMP/live.db" npx vitest run src/lib/__tests__/liveBookFlow.live.test.ts
