# D3 测试与视频可行性记录（2026-11-06，北京时间）

## 本次结论

本地接口检查完成；真实 OCR/VLM 解析及 I2V/T2V 视频验收仍阻塞。不能把错误处理通过当成真实解析成功，不能把前端录屏或FFmpeg蓝色视频当成模型生成。

- D3专项：12个pytest测试通过，对应16条CSV检查记录，16通过/0失败/0未测。通过率16/16只针对这些本地接口断言。
- 全部后端回归：30个pytest测试通过，含D3的12个，不是额外30个；3条依赖/生命周期弃用警告。
- 真实解析成功：未测/阻塞（PROVIDER_NOT_CONFIGURED）。
- 真实I2V/T2V：未测/阻塞，未取得真实成片、耗时和许可完整证据。
- 四类型扩展：12个自制文本样例，四类各2正常+1异常，全部未测；没有接入真实分析器。
- D2人工复核及PaddleOCR回归仍待办，D1的20条P0不在本次自动整体改为通过。

## 运行基线和范围

本次联网fetch并合并了用户上传的E分支8065bb5；独立副本测试前HEAD为bd5ae5b7359137ac82aaaaf2517142a21933bb2f，包含main 6ec10c996bfea272613634d9f3231deb60d6504a。B分支证据基线189f3632ebb13bb2424f3efe3acaec5d4dfa02d1。原GitHub本地仓库仍无backend/frontend目录，本次在此前同步的独立副本执行。

测试方式：pytest + FastAPI TestClient（HTTPX），真实应用代码、隔离临时SQLite和文件目录、自制可解码图片、每次随机本地测试令牌。不是已部署网络服务/浏览器联调，不调用模型。已有后端用例中部分笔记/分享测试在隔离库插入已分析状态，只能验证权限和状态处理；不能证明模型链路成功。新增D3测试没有伪造分析成功状态。

安装依赖仅在work/d3-deps，版本及系统见environment.json；许可证元数据见dependency-licenses.json。后端依赖原约束较宽，实际安装版本由本次环境记录锁定。没有修改项目生产依赖。

## 可重跑

先按 backend/README.md 准备Python和requirements，再在仓库根目录运行：

    .\scripts\test-e-d3.ps1 -Python .\backend\.venv\Scripts\python.exe

该脚本重跑D3专项，刷新CSV/JSON/JUnit。全部回归：

    $env:PYTHONPATH = "$PWD\backend"
    pytest -q backend/tests

原始响应在raw-responses.json，行级结果在test-cases.csv；XML为junit-d3.xml和junit-all.xml。duration_ms为TestClient调用及本地断言处理耗时，不是模型端到端延迟，不报告P50/P95。输出可能包含临时文件路径和随机运行ID，不含令牌；临时数据库退出后不作为交付物。

## 覆盖与观察

PNG/JPEG上传返回201并核对SHA256；空文件400、不支持MIME/PDF415、伪造PNG头415、截断PNG415、JPEG伪装PNG415、page_no=0返回422、超过10MiB返回413。重复页码409，先上传2再上传1后查询顺序为1、2。

分析前未确认类型409；确认后没有页面409；有页面后创建任务202，随后查询失败记录为PROVIDER_NOT_CONFIGURED。错误返回行为符合当前原型契约，但真实OCR/VLM仍不可用。

首轮测试曾因10MiB参数自动生成的测试名称过长，触发Windows临时目录错误（11通过2环境错误）；已给参数设置短case_id并重跑，最终专项12通过，全量30通过。没有修改被测应用代码掩盖失败。

## 视频与许可

视频状态见video-experiments.csv，来源与许可核查见../../sources/model-and-material-sources.md。B历史记录称本机8GB显存、无可用视频权重或获准远程provider；本次仅核对提交记录，不将其硬件或模型最低显存说明作为独立验证的现状。保留完整B实验文档快照供追溯。

## 交接和下一步

- 给A/B：11月6日视频可行性门槛尚未通过；请提供一个真实模型provider的成功和失败记录、成片及哈希、模型精确版本和许可、耗时、显存或账单、输入授权及提示词哈希。若更换provider由A调整范围。
- 给A：上传和错误文件16条接口检查通过；解析provider缺失时失败可追踪。接入B后重跑真实页面解析，核对页码/文本/实体。
- 给E：四书型12例先保持未测，D4可继续接入测试；不得将草案或mock写为正式验收。
- 本次不自动向他人发消息，不合并main，不创建或推送线上PR。
