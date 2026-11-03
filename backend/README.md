# 纸书智伴后端（第一天骨架）

## 1. 创建虚拟环境（Windows PowerShell）

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## 2. 启动 API

```powershell
$env:PYTHONPATH = (Get-Location).Path
uvicorn app.main:app --reload
```

启动后打开：

- 健康检查：`http://127.0.0.1:8000/health`
- 接口文档：`http://127.0.0.1:8000/docs`

## 3. 运行测试

```powershell
$env:PYTHONPATH = (Get-Location).Path
pytest -q
```

数据库会自动生成到项目根目录的 `data/paper_companion.db`，该文件只用于本地开发，不要上传到仓库。
