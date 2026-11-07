/**
 * 真实浏览器 CDP 端到端全流程与黑边门禁 (Real Browser CDP Gate)
 * 启动真实 FastAPI 后端与真实 Chrome，派发真实鼠标与输入事件，走完：
 * 填令牌 -> 导入建档 -> 自动分类 -> 确认分类 -> 发起分析 -> 如实失败 -> 开启书页问答 ->
 * 真实视频/书页黑边留白拦截验证 -> 真实有效画面点击留痕写入后端验证 ->
 * 录音提问留痕 -> 登记合成测试视频 -> 阅读页播放视频 -> 视频黑边拦截与视频帧触控留痕。
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const FRONTEND_DIST = path.join(ROOT_DIR, 'frontend', 'dist');
const BACKEND_PORT = 8991;
const FRONTEND_PORT = 8992;
const CDP_PORT = 9333;
const TOKEN = 'live-cdp-token-123';
// 第二个用户：只用于指定用户分享的身份核验
const READER_TOKEN = 'live-cdp-reader-456';

function log(msg) {
  console.log(`[CDP-Gate] ${msg}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'chromium',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c.includes('/') && fs.existsSync(c)) return c;
  }
  return null;
}

function startFrontendServer(port, backendPort) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.json': 'application/json',
  };

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: backendPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Backend proxy error', details: err.message }));
      });
      req.pipe(proxyReq);
      return;
    }

    let filePath = path.join(FRONTEND_DIST, req.url.split('?')[0]);
    if (filePath.endsWith(path.sep) || !path.extname(filePath)) {
      filePath = path.join(FRONTEND_DIST, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          fs.readFile(path.join(FRONTEND_DIST, 'index.html'), (e2, fallback) => {
            if (e2) {
              res.writeHead(404);
              res.end('Not Found');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(fallback);
            }
          });
        } else {
          res.writeHead(500);
          res.end(`Server Error: ${err.code}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      log(`前端托管代理已就绪: http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

async function waitForHttp(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, (res) => resolve(res.statusCode === 200));
        req.on('error', () => resolve(false));
      });
      if (ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    this.id += 1;
    const reqId = this.id;
    return new Promise((resolve, reject) => {
      this.callbacks.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  }

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  /** 用真实鼠标事件点击包含指定文字的按钮（先滚动到可见区域） */
  async clickButtonByText(text) {
    const rect = await this.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent && x.textContent.includes(${JSON.stringify(text)}));
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!rect) throw new Error(`[门禁失败] 找不到按钮：${text}`);
    await new Promise((r) => setTimeout(r, 200));
    await this.click(rect.x, rect.y);
  }

  /** 真实键盘输入（Input.insertText 走浏览器输入管线，React 能收到 input 事件） */
  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

/** 直接查后端（不经过前端），核验留痕是否真的写入 */
async function fetchInteractions(runId) {
  const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/runs/${encodeURIComponent(runId)}/interactions`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`[门禁失败] 读取后端交互记录 HTTP ${res.status}`);
  return res.json();
}

/** 端口已被占用时直接失败：否则会连上残留的旧后端/旧 Chrome，测到的不是本次启动的实例（E-031） */
async function assertPortFree(port, name) {
  const inUse = await new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(true); });
  });
  if (inUse) throw new Error(`[门禁失败] 端口 ${port}（${name}）已被占用，可能是上次残留的进程。请先结束它再运行门禁，避免测到旧实例。`);
}

/** dist 必须比所有前端源码新：构建失败时旧 dist 还在，门禁会测到旧代码却显示通过（E-031） */
function assertDistFresh() {
  const index = path.join(FRONTEND_DIST, 'index.html');
  if (!fs.existsSync(index)) throw new Error('[门禁失败] frontend/dist 不存在，请先 npm run build');
  const built = fs.statSync(index).mtimeMs;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const stale = walk(path.join(ROOT_DIR, 'frontend', 'src')).filter((f) => fs.statSync(f).mtimeMs > built);
  if (stale.length) throw new Error(`[门禁失败] frontend/dist 比源码旧（构建失败或未重新构建）：${stale.slice(0, 3).map((f) => path.relative(ROOT_DIR, f)).join(', ')}`);
}

async function run() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('未找到可用 Chrome/Edge，无法执行真实浏览器 CDP 门禁');
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-gate-'));
  const dbPath = path.join(tmpDir, 'test.db');
  let backendProc = null;
  let chromeProc = null;
  let frontendServer = null;
  let exitCode = 1;

  try {
    assertDistFresh();
    await assertPortFree(BACKEND_PORT, '后端');
    await assertPortFree(FRONTEND_PORT, '前端');
    await assertPortFree(CDP_PORT, 'Chrome 调试');
    log('1. 启动真实 FastAPI 后端 (临时 SQLite 数据库)...');
    const py = path.join(BACKEND_DIR, '.venv', 'bin', 'python');
    backendProc = spawn(
      py,
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT), '--log-level', 'warning'],
      {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          APP_USER_TOKENS: JSON.stringify({ live_check: TOKEN, reader_02: READER_TOKEN }),
          DATABASE_PATH: dbPath,
          DATA_ROOT: tmpDir,
        },
        stdio: 'ignore',
      }
    );

    const backendReady = await waitForHttp(`http://127.0.0.1:${BACKEND_PORT}/health`);
    if (!backendReady) throw new Error('FastAPI 后端启动超时');
    log('FastAPI 后端已就绪');

    log('2. 启动前端托管服务器并设置 API 反向代理...');
    frontendServer = await startFrontendServer(FRONTEND_PORT, BACKEND_PORT);

    log('3. 启动无头 Chrome 并开启 CDP 调试通道...');
    const userProfile = path.join(tmpDir, 'chrome-profile');
    chromeProc = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1440,1200',
        // Chrome 虚拟麦克风：真实走 getUserMedia + MediaRecorder + WAV 编码（输入是测试音，不是人声）。
        // 不能加 --use-fake-ui-for-media-stream：它会自动同意授权，盖过 Browser.setPermission(denied)，
        // "麦克风被拒绝"分支就测不到了（E-031：上一轮这一步其实连的是残留的旧 Chrome）。
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userProfile}`,
        `http://127.0.0.1:${FRONTEND_PORT}/#/import`,
      ],
      { stdio: 'ignore' }
    );

    const cdpReady = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (!cdpReady) throw new Error('Chrome CDP 调试端口启动超时');

    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('未找到浏览器页面 target');

    const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    log('CDP 已建立 WebSocket 调试连接');

    await cdp.send('Runtime.enable');
    cdp.ws.addEventListener('message', (msg) => {
      const d = JSON.parse(msg.data);
      if (d.method === 'Runtime.consoleAPICalled') {
        const text = d.params.args.map((a) => a.value || a.description || '').join(' ');
        if (text) console.log(`[Browser-Console] ${text}`);
      }
    });

    // 先写入 Token 到 localStorage，并触发刷新保证所有模块加载时读取到 Token
    await cdp.evaluate(`(() => {
      localStorage.setItem('AUTH_BEARER_TOKEN', '${TOKEN}');
      location.hash = '#/import';
      location.reload();
    })()`);
    await new Promise((r) => setTimeout(r, 2000));

    const tokenInStorage = await cdp.evaluate('localStorage.getItem("AUTH_BEARER_TOKEN")');
    log(`确认 localStorage Token: ${tokenInStorage}`);

    // ----------------------------------------------------
    // 步骤 B: 在导入页面选择原创绘本样例并完成建档
    // ----------------------------------------------------
    log('步骤 B: 真实页面导入绘本并在后端建档...');
    // 1. 先点击“试用原创示例”加载书页与标题
    await cdp.evaluate(`(() => {
      const demoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('试用原创示例'));
      if (demoBtn) demoBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 600));

    // 2. 在示例加载完成后，再勾选授权声明
    await cdp.evaluate(`(() => {
      const authCheckbox = document.querySelector('input[type="checkbox"]');
      if (authCheckbox) {
        authCheckbox.click();
      }
    })()`);
    await new Promise((r) => setTimeout(r, 400));

    // 3. 点击“确认导入预览”
    await cdp.evaluate(`(() => {
      const submitBtn = document.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 1200));

    // 4. 点击“继续校对书页”（触发真实建档与分类）
    const importStepRes = await cdp.evaluate(`(() => {
      const continueBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('继续校对书页'));
      if (!continueBtn) {
        const errors = Array.from(document.querySelectorAll('.form-errors li')).map(li => li.textContent);
        return 'CONTINUE_BTN_NOT_FOUND: ' + errors.join('; ');
      }
      continueBtn.click();
      return 'CLICKED_CONTINUE';
    })()`);
    log(`导入提交结果: ${importStepRes}`);
    await new Promise((r) => setTimeout(r, 2000));

    const pageAfterImport = await cdp.evaluate('window.location.hash');
    const toastAfterImport = await cdp.evaluate('document.querySelector(".toast") ? document.querySelector(".toast").textContent : ""');
    log(`导入后路由: ${pageAfterImport}, Toast: ${toastAfterImport}`);

    // ----------------------------------------------------
    // 步骤 C: 逐页文字校对与确认
    // ----------------------------------------------------
    log('步骤 C: 逐页完成文字校对与确认...');
    for (let i = 0; i < 3; i++) {
      await cdp.evaluate(`(() => {
        const pageBtns = document.querySelectorAll('.page-order li .page-select');
        if (pageBtns[${i}]) pageBtns[${i}].click();
      })()`);
      await new Promise((r) => setTimeout(r, 300));
      await cdp.evaluate(`(() => {
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('确认此页'));
        if (confirmBtn) confirmBtn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
    }

    const toClassRes = await cdp.evaluate(`(() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('下一步：分类确认'));
      if (!nextBtn) return 'NEXT_BTN_NOT_FOUND';
      nextBtn.click();
      return 'CLICKED_NEXT';
    })()`);
    log(`进入分类结果: ${toClassRes}`);
    await new Promise((r) => setTimeout(r, 1000));

    // ----------------------------------------------------
    // 步骤 D: 图书分类确认并开始分析
    // ----------------------------------------------------
    log('步骤 D: 图书分类确认并开始分析生成...');
    // 1. 先明确选中“绘本”类型单选框
    await cdp.evaluate(`(() => {
      const radio = document.querySelector('input[type="radio"][value="picture_book"]');
      if (radio) {
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await new Promise((r) => setTimeout(r, 400));

    // 2. 点击“确认图书类型”
    const confirmTypeRes = await cdp.evaluate(`(() => {
      const confirmTypeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('确认图书类型'));
      if (!confirmTypeBtn) return 'CONFIRM_TYPE_BTN_NOT_FOUND';
      confirmTypeBtn.click();
      return 'CLICKED_CONFIRM_TYPE';
    })()`);
    log(`点击确认图书类型: ${confirmTypeRes}`);
    await new Promise((r) => setTimeout(r, 1500));

    const classStateAfterConfirm = await cdp.evaluate(`(() => {
      const err = document.querySelector('.wf-error');
      const toast = document.querySelector('.toast');
      const startBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('开始分析与生成'));
      return {
        err: err ? err.textContent : '',
        toast: toast ? toast.textContent : '',
        startBtnDisabled: startBtn ? startBtn.disabled : 'NOT_FOUND',
      };
    })()`);
    log(`分类确认后状态: ${JSON.stringify(classStateAfterConfirm)}`);

    // 2. 点击“开始分析与生成”
    const startAnalysisRes = await cdp.evaluate(`(() => {
      const startBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('开始分析与生成'));
      if (!startBtn) return 'START_BTN_NOT_FOUND';
      startBtn.click();
      return 'CLICKED_START';
    })()`);
    log(`发起分析结果: ${startAnalysisRes}`);

    // 等待真实分析任务上传书页、后端执行并如实反馈失败（轮询最多 15 秒）
    let hasFailed = false;
    for (let wait = 0; wait < 30; wait++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusText = await cdp.evaluate(`(() => {
        const pageOnlyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('先用校对文字做书页问答'));
        const errorPanel = document.querySelector('.progress-error');
        const toast = document.querySelector('.toast');
        return {
          hash: window.location.hash,
          bodyText: document.body.innerText.slice(0, 100).replace(/\\n/g, ' '),
          hasBtn: Boolean(pageOnlyBtn),
          err: errorPanel ? errorPanel.textContent : '',
          toast: toast ? toast.textContent : '',
        };
      })()`);
      if (wait % 4 === 0) {
        log(`轮询中 [${wait}]: hash=${statusText.hash}, body=${statusText.bodyText}, toast=${statusText.toast}`);
      }
      if (statusText.hasBtn) {
        hasFailed = true;
        log(`分析任务如实反馈完成: ${statusText.err.slice(0, 100)}`);
        break;
      }
    }
    if (!hasFailed) throw new Error('等待后端分析任务失败超时');

    // ----------------------------------------------------
    // 步骤 E: 点击“先用校对文字做书页问答”进入阅读页
    // ----------------------------------------------------
    log('步骤 E: 开启书页问答并进入阅读空间...');
    const pageOnlyRes = await cdp.evaluate(`(() => {
      const pageOnlyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('先用校对文字做书页问答'));
      if (!pageOnlyBtn) return 'PAGE_ONLY_BTN_NOT_FOUND';
      pageOnlyBtn.click();
      return 'CLICKED_PAGE_ONLY';
    })()`);
    log(`开启书页问答结果: ${pageOnlyRes}`);
    await new Promise((r) => setTimeout(r, 1200));

    // ----------------------------------------------------
    // 步骤 F: 真实视频/书页画面尺寸与黑边留白拦截验证
    // ----------------------------------------------------
    log('步骤 F: 验证黑边留白点击拦截与真实有效内容点击留痕...');
    // 1. 点击“点击认物”开启触控模式
    const toggleTouchRes = await cdp.evaluate(`(() => {
      const touchBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('点击认物'));
      if (touchBtn) {
        touchBtn.click();
        return 'CLICKED_TOUCH_MODE';
      }
      return 'TOUCH_BTN_NOT_FOUND';
    })()`);
    log(`开启触控模式: ${toggleTouchRes}`);
    await new Promise((r) => setTimeout(r, 600));

    await cdp.evaluate(`(() => {
      const frame = document.querySelector('[aria-label="阅读画面"]') || document.querySelector('.reader-frame');
      if (frame) frame.scrollIntoView({ block: 'center' });
    })()`);
    await new Promise((r) => setTimeout(r, 400));

    const frameRect = await cdp.evaluate(`(() => {
      const frame = document.querySelector('[aria-label="阅读画面"]') || document.querySelector('.reader-frame');
      if (!frame) return null;
      const r = frame.getBoundingClientRect();
      const img = frame.querySelector('img');
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        imgNaturalW: img ? img.naturalWidth : null,
        imgNaturalH: img ? img.naturalHeight : null,
      };
    })()`);
    if (!frameRect) throw new Error('未找到阅读画面');
    log(`当前阅读画面尺寸: ${JSON.stringify(frameRect)}`);

    // 1. 派发点击到【黑边留白】(最左边缘留白区域)
    const pillarboxClickX = frameRect.left + 5;
    const pillarboxClickY = frameRect.top + frameRect.height / 2;
    log(`派发真实 CDP 鼠标点击到黑边留白区域: (${pillarboxClickX}, ${pillarboxClickY})`);
    await cdp.click(pillarboxClickX, pillarboxClickY);
    await new Promise((r) => setTimeout(r, 500));

    const errorMsg = await cdp.evaluate(`(() => {
      const err = document.querySelector('.assistant-error');
      return err ? err.textContent : '';
    })()`);
    log(`黑边点击后页面拦截提示: ${errorMsg}`);
    if (!errorMsg.includes('黑边') && !errorMsg.includes('留白')) {
      throw new Error(`[门禁失败] 黑边点击未被拦截！页面提示为: "${errorMsg}"`);
    }
    log('✓ [PASS] 真实浏览器黑边点击被成功拦截，界面给出明确警告');

    // 2. 派发点击到【有效画面中心内容】
    const contentClickX = frameRect.left + frameRect.width / 2;
    const contentClickY = frameRect.top + frameRect.height / 2;
    log(`派发真实 CDP 鼠标点击到画面有效中心内容: (${contentClickX}, ${contentClickY})`);
    await cdp.click(contentClickX, contentClickY);
    await new Promise((r) => setTimeout(r, 1200));

    // 3. 验证交互结果展示与后端真实留痕记录
    const interactionCard = await cdp.evaluate(`(() => {
      const card = document.querySelector('.answer-card');
      const err = document.querySelector('.assistant-error');
      return {
        card: card ? card.textContent : '',
        err: err ? err.textContent : '',
      };
    })()`);
    log(`画面内容点击后卡片展示: ${JSON.stringify(interactionCard)}`);

    if (!interactionCard.card.includes('画面里的发现') && !interactionCard.card.includes('点击位置')) {
      throw new Error(`[门禁失败] 画面有效内容点击未生成识别卡片: ${JSON.stringify(interactionCard)}`);
    }
    log('✓ [PASS] 画面有效内容点击成功生成交互卡片');

    // 4. 不再只看卡片文字：直接查后端，确认触控留痕真的写进去了
    const runId = await cdp.evaluate(`(() => {
      const m = (document.querySelector('.run-metadata')?.textContent || '').match(/run_id:\\s*([^\\s·]+)/);
      return m ? m[1] : null;
    })()`);
    if (!runId || runId === '未关联') throw new Error(`[门禁失败] 页面上读不到 run_id: ${runId}`);
    let records = await fetchInteractions(runId);
    const touchRec = records.find((r) => r.interaction_type === 'touch');
    if (!touchRec) throw new Error(`[门禁失败] 后端没有触控留痕: ${JSON.stringify(records)}`);
    if (!(touchRec.input.norm_x >= 0 && touchRec.input.norm_x <= 1) || touchRec.output.target !== '' || touchRec.output.recognition !== 'not_connected') {
      throw new Error(`[门禁失败] 触控留痕内容不符合预期: ${JSON.stringify(touchRec)}`);
    }
    log(`✓ [PASS] 后端确有触控留痕 (run_id=${runId}, norm=(${touchRec.input.norm_x}, ${touchRec.input.norm_y}), recognition=not_connected)`);

    // ----------------------------------------------------
    // 步骤 G: 真实录音（虚拟麦克风）→ WAV → 识别 → 提问 → 后端留痕带音频指纹
    // ----------------------------------------------------
    log('步骤 G: 真实录音提问链路...');
    await cdp.clickButtonByText('退出认物');
    await new Promise((r) => setTimeout(r, 300));
    // G-1 麦克风权限被拒绝：显式拒绝后点击录音，必须给出权限提示且不进入录音
    const origin = `http://127.0.0.1:${FRONTEND_PORT}`;
    await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin });
    await cdp.clickButtonByText('点击录音提问');
    await new Promise((r) => setTimeout(r, 1200));
    const deniedState = await cdp.evaluate(`(() => ({
      recording: Array.from(document.querySelectorAll('button')).some(b => b.textContent && b.textContent.includes('结束录音')),
      warn: Array.from(document.querySelectorAll('div')).map(d => d.textContent).filter(t => t && t.startsWith('⚠️')).join(' | '),
    }))()`);
    if (deniedState.recording || !deniedState.warn.includes('麦克风权限被拒绝')) {
      throw new Error(`[门禁失败] 麦克风被拒绝时没有如实提示: ${JSON.stringify(deniedState)}`);
    }
    log('✓ [PASS] 麦克风权限被拒绝：不进入录音，提示"麦克风权限被拒绝"');

    // G-2 麦克风权限允许：虚拟麦克风真实录音
    await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'granted', origin });
    await cdp.clickButtonByText('点击录音提问');
    await new Promise((r) => setTimeout(r, 2500));
    await cdp.clickButtonByText('结束录音');
    // 识别器 stop 最多等 2.5s，WAV 解码再要一点时间
    let rec = null;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      rec = await cdp.evaluate(`(() => ({
        info: Array.from(document.querySelectorAll('span')).map(s => s.textContent).find(t => t && (t.includes('标准 WAV') || t.includes('原始录音'))) || '',
        hasAudio: Boolean(document.querySelector('audio[src^="blob:"]')),
        hasDownload: Boolean(Array.from(document.querySelectorAll('a[download]')).find(a => a.textContent.includes('保存录音文件'))),
        question: document.querySelector('#reader-question')?.value ?? null,
        err: document.querySelector('.assistant-error')?.textContent || '',
      }))()`);
      if (rec.info) break;
    }
    log(`录音结果: ${JSON.stringify(rec)}`);
    if (!rec.info.includes('标准 WAV (16kHz') || !rec.hasAudio || !rec.hasDownload) {
      throw new Error(`[门禁失败] 录音未生成可回放/可保存的 16kHz WAV: ${JSON.stringify(rec)}`);
    }
    log('✓ [PASS] 虚拟麦克风真实录音并编码为 16kHz WAV，可回放、可保存');
    // 虚拟麦克风是测试音：识别不出文字时，问题框必须保持为空并提示，不能替用户造句
    const recognized = (rec.question || '').trim();
    if (!recognized) {
      if (!rec.err.includes('录音已保存')) throw new Error(`[门禁失败] 识别失败但没有如实提示: ${JSON.stringify(rec)}`);
      log('✓ [PASS] 测试音未被识别出文字，问题框保持为空并如实提示（未编造问题）');
    } else {
      log(`识别器返回了文字（将作为识别原文留痕）: ${recognized}`);
    }

    // 用户改为打字提问；这段录音应作为样本随提问一起留痕
    const typedQuestion = '小狐狸收到了什么';
    await cdp.evaluate(`(() => { const t = document.querySelector('#reader-question'); t.focus(); t.select(); })()`);
    await cdp.insertText(typedQuestion);
    await new Promise((r) => setTimeout(r, 200));
    await cdp.clickButtonByText('问问伴读助手');
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 300));
      records = await fetchInteractions(runId);
      if (records.some((r) => r.interaction_type === 'voice')) break;
    }
    const voiceRec = records.find((r) => r.interaction_type === 'voice');
    if (!voiceRec) throw new Error(`[门禁失败] 提问后后端没有问答留痕: ${JSON.stringify(records)}`);
    const vi = voiceRec.input;
    log(`后端问答留痕 input: ${JSON.stringify(vi)}`);
    if (vi.query !== typedQuestion || vi.audio_present !== true || !/^[0-9a-f]{64}$/.test(vi.audio?.sha256 || '') ||
        vi.audio.mime_type !== 'audio/wav' || !(vi.audio.size_bytes > 44) || vi.audio.storage !== 'browser_only' ||
        vi.asr_transcript !== recognized || vi.transcript_edited !== (recognized !== typedQuestion)) {
      throw new Error(`[门禁失败] 问答留痕的音频/转写字段不符合预期: ${JSON.stringify(vi)}`);
    }
    if (typeof voiceRec.output.cache_hit !== 'boolean') throw new Error('[门禁失败] 问答留痕缺少 cache_hit');
    log(`✓ [PASS] 后端问答留痕带音频指纹 sha256=${vi.audio.sha256.slice(0, 12)}… (${vi.audio.size_bytes} B, ${vi.audio.duration_ms} ms)、识别原文与 cache_hit`);

    // ----------------------------------------------------
    // 步骤 H: 视频产物 → 阅读页播放 → 在视频帧上测黑边拦截与触控留痕（E-028）
    // 用的是 scripts/fixtures 里的合成测试视频（4:3），不是 B 的生成结果
    // ----------------------------------------------------
    log('步骤 H: 登记视频产物并在真实视频上触控...');
    const fixture = path.join(__dirname, 'fixtures', 'synthetic-test-video.mp4');
    const runDir = path.join(tmpDir, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    const videoPath = path.join(runDir, 'synthetic-test-video.mp4');
    fs.copyFileSync(fixture, videoPath);
    const regRes = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/runs/${encodeURIComponent(runId)}/assets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_type: 'video', file_path: videoPath, mime_type: 'video/mp4', duration_ms: 3000, metadata: { producer: 'cdp_gate_synthetic_fixture' } }),
    });
    if (regRes.status !== 201) throw new Error(`[门禁失败] 登记视频产物失败 HTTP ${regRes.status}: ${await regRes.text()}`);
    const asset = await regRes.json();
    log(`已登记合成测试视频: asset=${asset.id}, sha256=${asset.sha256.slice(0, 12)}…`);

    // 进入阅读页时已查过一次（当时没有视频），页面必须如实显示"尚未登记"，并提供重新检查
    const noVideoBanner = await cdp.evaluate(`document.querySelector('[data-video-status]')?.getAttribute('data-video-status') || ''`);
    if (noVideoBanner !== 'none') throw new Error(`[门禁失败] 登记前页面没有如实显示"尚无视频": ${noVideoBanner}`);
    log('✓ [PASS] 登记视频前：页面如实显示"后端尚未登记本次运行的视频"');
    await cdp.clickButtonByText('重新检查视频');
    let vstate = null;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      vstate = await cdp.evaluate(`(() => {
        const v = document.querySelector('video[aria-label="互动阅读视频"]');
        return { banner: document.querySelector('[data-video-status]')?.getAttribute('data-video-status') || '',
          src: v ? v.currentSrc : '', readyState: v ? v.readyState : -1, w: v ? v.videoWidth : 0, h: v ? v.videoHeight : 0,
          duration: v ? v.duration : 0, img: Boolean(document.querySelector('.reader-frame img')) };
      })()`);
      if (vstate.readyState >= 2) break;
    }
    log(`视频加载状态: ${JSON.stringify(vstate)}`);
    if (vstate.banner !== 'ready' || !vstate.src.startsWith('blob:') || vstate.readyState < 2 || vstate.w !== 640 || vstate.h !== 480 || vstate.img) {
      throw new Error(`[门禁失败] 阅读页没有播放后端登记的视频: ${JSON.stringify(vstate)}`);
    }
    if (!(Math.abs(vstate.duration - 3) < 0.5)) throw new Error(`[门禁失败] 视频时长不对: ${vstate.duration}`);
    log('✓ [PASS] 阅读页带令牌下载视频并播放（blob: URL，640×480，约 3 秒），静态书页已替换');

    await cdp.clickButtonByText('点击认物');
    await new Promise((r) => setTimeout(r, 400));
    const vrect = await cdp.evaluate(`(() => {
      const v = document.querySelector('video[aria-label="互动阅读视频"]');
      v.scrollIntoView({ block: 'center' });
      const r = v.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    await new Promise((r) => setTimeout(r, 300));
    // 4:3 视频放进 16:10 画框 → 左右各有黑边
    const renderW = vrect.height * (640 / 480);
    const sideBar = (vrect.width - renderW) / 2;
    log(`视频画框 ${JSON.stringify(vrect)}，理论黑边宽 ${sideBar.toFixed(1)}px`);
    if (!(sideBar > 20)) throw new Error(`[门禁失败] 预期有左右黑边，实际 ${sideBar}`);
    const before = (await fetchInteractions(runId)).filter((r) => r.interaction_type === 'touch').length;
    await cdp.click(vrect.left + sideBar / 2, vrect.top + vrect.height / 2);
    await new Promise((r) => setTimeout(r, 500));
    const vErr = await cdp.evaluate(`document.querySelector('.assistant-error')?.textContent || ''`);
    const afterBar = (await fetchInteractions(runId)).filter((r) => r.interaction_type === 'touch').length;
    if (!(vErr.includes('黑边') || vErr.includes('留白')) || afterBar !== before) {
      throw new Error(`[门禁失败] 视频黑边点击未被拦截或被上报: err="${vErr}", 记录 ${before}→${afterBar}`);
    }
    log('✓ [PASS] 视频黑边点击被拦截，没有上报后端');

    // 点击视频画面里橙色圆的中心（原始坐标 320,240）
    await cdp.click(vrect.left + vrect.width / 2, vrect.top + vrect.height / 2);
    let vtouch = null;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      const list = (await fetchInteractions(runId)).filter((r) => r.interaction_type === 'touch');
      if (list.length > before) { vtouch = list[list.length - 1]; break; }
    }
    if (!vtouch) throw new Error('[门禁失败] 视频画面点击没有写入后端');
    const vi2 = vtouch.input;
    log(`视频触控留痕 input: ${JSON.stringify({ norm: [vi2.norm_x, vi2.norm_y], px: [vi2.pixel_x, vi2.pixel_y], wh: [vi2.video_width, vi2.video_height], frame_source: vi2.frame_source, frame_snapshot: vi2.frame_snapshot })}`);
    if (vi2.frame_source?.kind !== 'video' || vi2.frame_source.asset_sha256 !== asset.sha256 || vi2.frame_source.asset_id !== asset.id ||
        vi2.video_width !== 640 || vi2.video_height !== 480 || Math.abs(vi2.pixel_x - 320) > 3 || Math.abs(vi2.pixel_y - 240) > 3 ||
        !/^[0-9a-f]{64}$/.test(vi2.frame_snapshot?.sha256 || '') || vi2.frame_snapshot.width !== 640 || vi2.frame_snapshot.storage !== 'browser_only' ||
        vtouch.output.recognition !== 'not_connected' || vtouch.output.target !== '') {
      throw new Error(`[门禁失败] 视频触控留痕不符合预期: ${JSON.stringify(vtouch)}`);
    }
    log(`✓ [PASS] 视频触控留痕：frame_source=video（产物 sha256 一致）、原始像素≈(320,240)/640×480、截图指纹 ${vi2.frame_snapshot.sha256.slice(0, 12)}…；未接视觉模型如实记为 not_connected`);

    // ----------------------------------------------------
    // 步骤 I: Live 只读分享由服务端核验（E-029）：有效链接 / 撤销 / 过期 / 指定用户身份
    // 前置条件说明：A 的笔记生成要求"真实分析成功"，而本环境没有分析 provider（步骤 D 如实失败），
    // 所以这里直接在【临时测试库】插入一条 DRAFT 笔记；审核、分享、撤销全部走 A 的真实接口。
    // ----------------------------------------------------
    log('步骤 I: Live 只读分享服务端核验...');
    const api = async (method, p, body, token = TOKEN) => {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}${p}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    };
    const run = await api('GET', `/api/runs/${encodeURIComponent(runId)}`);
    const noteId = `cdp-note-${Date.now()}`;
    const ins = spawnSync(path.join(BACKEND_DIR, '.venv', 'bin', 'python'), ['-c', `
import sqlite3, json, sys
c = sqlite3.connect(sys.argv[1])
content = {"title": "门禁测试笔记", "summary": "小狐狸收到了一封信。", "concepts": ["友谊"], "sources": [{"page_no": 1, "quote": "门禁测试引用", "start_ms": None, "end_ms": None}]}
c.execute("INSERT INTO reading_notes(id,book_id,owner_id,content_json,status,version,created_at,updated_at) VALUES(?,?,?,?, 'DRAFT', 1, datetime('now'), datetime('now'))", (sys.argv[2], sys.argv[3], 'live_check', json.dumps(content, ensure_ascii=False)))
c.commit()
`, dbPath, noteId, run.data.book_id], { encoding: 'utf8' });
    if (ins.status !== 0) throw new Error(`[门禁失败] 测试库插入笔记失败: ${ins.stderr}`);
    const approved = await api('POST', `/api/notes/${noteId}/review`, { action: 'approve' });
    if (approved.status !== 200 || approved.data.status !== 'PRIVATE') throw new Error(`[门禁失败] 真实审核接口未通过: ${JSON.stringify(approved)}`);
    const future = (sec) => new Date(Date.now() + sec * 1000).toISOString();
    const link = await api('POST', `/api/notes/${noteId}/shares`, { share_mode: 'link', expires_at: future(600) });
    const shortLink = await api('POST', `/api/notes/${noteId}/shares`, { share_mode: 'link', expires_at: future(3) });
    const invite = await api('POST', `/api/notes/${noteId}/shares`, { share_mode: 'invite_only', shared_user_id: 'reader_02', expires_at: future(600) });
    if (link.status !== 201 || !link.data.token || shortLink.status !== 201 || invite.status !== 201) throw new Error(`[门禁失败] 创建分享失败: ${JSON.stringify([link, shortLink, invite])}`);

    const openShared = async (hash) => {
      await cdp.evaluate(`(() => { location.hash = ${JSON.stringify(hash)}; })()`);
      let st = null;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        st = await cdp.evaluate(`(() => { const el = document.querySelector('[data-shared-status]');
          return el ? { status: el.getAttribute('data-shared-status'), code: el.getAttribute('data-shared-code'), text: el.innerText.slice(0, 160) } : null; })()`);
        if (st && st.status !== 'loading') break;
      }
      return st;
    };
    // 先清掉本地分享快照：证明只读页不是靠本地数据显示的
    await cdp.evaluate(`(() => { for (const k of Object.keys(sessionStorage)) if (k.startsWith('paper-companion-full-v1')) { const d = JSON.parse(sessionStorage.getItem(k)); d.grants = []; sessionStorage.setItem(k, JSON.stringify(d)); } })()`);
    let st = await openShared(`#/shared?token=${encodeURIComponent(link.data.token)}`);
    if (st?.status !== 'ok' || !st.text.includes('门禁测试笔记') || !st.text.includes('服务端已核验')) throw new Error(`[门禁失败] 有效链接未显示服务端内容: ${JSON.stringify(st)}`);
    log('✓ [PASS] 有效限时链接：本地没有任何分享记录，仍从服务端读到并只读显示笔记');
    st = await openShared(`#/shared?token=not-a-real-token`);
    if (st?.status !== 'denied' || st.code !== 'NOT_FOUND' || st.text.includes('门禁测试笔记')) throw new Error(`[门禁失败] 伪造令牌未被拒绝: ${JSON.stringify(st)}`);
    const revoked = await api('DELETE', `/api/notes/${noteId}/shares/${link.data.id}`);
    if (revoked.status !== 204) throw new Error(`[门禁失败] 撤销失败: ${JSON.stringify(revoked)}`);
    st = await openShared(`#/shared?token=${encodeURIComponent(link.data.token)}&r=1`);
    if (st?.status !== 'denied' || st.code !== 'NOT_FOUND' || st.text.includes('门禁测试笔记')) throw new Error(`[门禁失败] 撤销后仍可访问: ${JSON.stringify(st)}`);
    log('✓ [PASS] 伪造令牌与已撤销链接：服务端拒绝(404)，页面不显示任何笔记内容');
    await new Promise((r) => setTimeout(r, 3500));
    st = await openShared(`#/shared?token=${encodeURIComponent(shortLink.data.token)}`);
    if (st?.status !== 'denied' || st.code !== 'GONE' || st.text.includes('门禁测试笔记')) throw new Error(`[门禁失败] 过期链接未被拒绝: ${JSON.stringify(st)}`);
    log('✓ [PASS] 过期链接：服务端返回 410，页面显示"已经过期"');
    const inviteHash = `#/shared?note=${encodeURIComponent(noteId)}&share=${encodeURIComponent(invite.data.id)}`;
    if (inviteHash.includes(TOKEN) || invite.data.token) throw new Error('[门禁失败] 指定用户分享不应产生/携带令牌');
    st = await openShared(inviteHash);
    if (st?.status !== 'denied' || st.code !== 'NOT_FOUND') throw new Error(`[门禁失败] 主人以外身份核验未生效（主人令牌也不应能走邀请视图）: ${JSON.stringify(st)}`);
    await cdp.evaluate(`(() => { localStorage.setItem('AUTH_BEARER_TOKEN', '${READER_TOKEN}'); location.hash = ${JSON.stringify(inviteHash)}; location.reload(); })()`);
    await new Promise((r) => setTimeout(r, 1500));
    st = await openShared(inviteHash);
    if (st?.status !== 'ok' || !st.text.includes('门禁测试笔记')) throw new Error(`[门禁失败] 被邀请人用自己的令牌无法查看: ${JSON.stringify(st)}`);
    log('✓ [PASS] 指定用户分享：链接不含令牌；非被邀请身份被拒，被邀请人用自己的令牌可只读查看');

    cdp.close();
    log('=== [SUCCESS] 真实浏览器 CDP 端到端门禁全部通过！===');
    exitCode = 0;
  } catch (err) {
    console.error('=== [FAIL] 门禁执行异常 ===', err);
    exitCode = 1;
  } finally {
    // 旧实现在 try/catch 里直接 process.exit()，finally 永远不执行：每跑一次就残留一个后端和一个无头 Chrome，
    // 下一次运行会连上残留实例（E-031）。现在先清理、等子进程退出，再退出。
    if (backendProc) backendProc.kill();
    if (chromeProc) chromeProc.kill();
    if (frontendServer) frontendServer.close();
    const waitExit = (proc) => new Promise((resolve) => {
      if (!proc || proc.exitCode !== null || proc.signalCode) return resolve();
      const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* 已退出 */ } resolve(); }, 3000);
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await Promise.all([waitExit(backendProc), waitExit(chromeProc)]);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('[cleanup] 临时目录清理告警:', cleanupErr.message);
    }
  }
  process.exit(exitCode);
}

run();
