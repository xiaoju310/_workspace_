// 离线原型门禁：用真实浏览器打开产物，确认页面真的渲染出来。
// "打包成功"不等于"能打开"：此前产物因 import.meta 语法错误白屏，打包命令却一直通过。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const html = path.resolve(__dirname, '../../docs/prototype/paper-companion-full.html');
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome',
  'chromium',
  'chromium-browser',
  'msedge',
].filter(Boolean);

const browser = candidates.find((c) => (c.includes('/') ? fs.existsSync(c) : spawnSync('which', [c]).status === 0));
if (!browser) {
  console.error('未验证：找不到 Chrome/Edge，无法确认离线原型能否渲染（可设置 CHROME_PATH）。');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-check-'));
const run = spawnSync(
  browser,
  ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--virtual-time-budget=6000', '--dump-dom', `file://${html}#/reader`],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 }
);
fs.rmSync(profile, { recursive: true, force: true });

const dom = run.stdout || '';
const problems = [];
if (run.status !== 0) problems.push(`浏览器退出码 ${run.status}`);
if (/<div id="root">\s*<\/div>/.test(dom) || !dom.includes('id="root"')) problems.push('#root 为空（页面白屏）');
for (const text of ['翻开故事', '点击认物', '演示模式']) if (!dom.includes(text)) problems.push(`缺少应渲染的文字：${text}`);
if (problems.length) {
  console.error('离线原型渲染失败：\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`离线原型渲染通过（${path.basename(browser)}，阅读页已挂载，Demo 模式）`);
