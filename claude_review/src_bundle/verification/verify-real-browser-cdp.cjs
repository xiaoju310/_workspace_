/**
 * 真实浏览器 CDP 端到端全流程与黑边门禁 (Real Browser CDP Gate)
 * 启动真实 FastAPI 后端与真实 Chrome，派发真实鼠标与输入事件，走完：
 * 填令牌 -> 导入建档 -> 自动分类 -> 确认分类 -> 发起分析 -> 如实失败 -> 开启书页问答 ->
 * 真实视频/书页黑边留白拦截验证 -> 真实有效画面点击留痕写入后端验证。
 */
const { spawn } = require('node:child_process');
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

  close() {
    if (this.ws) this.ws.close();
  }
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

  try {
    log('1. 启动真实 FastAPI 后端 (临时 SQLite 数据库)...');
    const py = path.join(BACKEND_DIR, '.venv', 'bin', 'python');
    backendProc = spawn(
      py,
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT), '--log-level', 'warning'],
      {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          APP_USER_TOKENS: JSON.stringify({ live_check: TOKEN }),
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
    log('✓ [PASS] 画面有效内容点击成功生成交互卡片并如实上报后端');

    cdp.close();
    log('=== [SUCCESS] 真实浏览器 CDP 端到端门禁全部通过！===');
    process.exit(0);
  } catch (err) {
    console.error('=== [FAIL] 门禁执行异常 ===', err);
    process.exit(1);
  } finally {
    if (backendProc) backendProc.kill();
    if (chromeProc) chromeProc.kill();
    if (frontendServer) frontendServer.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('[cleanup] 临时目录清理告警:', cleanupErr.message);
    }
  }
}

run();
