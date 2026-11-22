// 把 src 下的 TS/TSX 转译并打包成单文件离线预览页（不需要服务器、不需要网络）。
// 当前电脑版的独立离线预览生成器，输出本目录 preview.html。
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const modules = {};
const errors = [];

function walk(folder) {
  for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !file.endsWith('.d.ts') && !file.includes('__tests__')) {
      const id = path.relative(src, file).replaceAll('\\', '/').replace(/\.tsx?$/, '');
      const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, isolatedModules: true },
      });
      errors.push(...(result.diagnostics || []).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')));
      // CommonJS 运行时里 import.meta 是语法错误，会让整个离线页白屏；离线包固定为 Demo 模式
      modules[id] = result.outputText.replace(/import\.meta\.env/g, "({VITE_DEFAULT_MODE:'demo'})");
    }
  }
}

walk(src);
if (errors.length) throw new Error(errors.join('\n'));

const art = {};
const artDir = path.join(root, 'public/art');
for (const file of fs.readdirSync(artDir)) {
  const mime = path.extname(file) === '.png' ? 'image/png' : 'image/svg+xml';
  art[`/art/${file}`] = `data:${mime};base64,${fs.readFileSync(path.join(artDir, file)).toString('base64')}`;
}

const registry = Object.entries(modules).map(([id, code]) => `${JSON.stringify(id)}: function(require,module,exports){\n${code.replaceAll('</script', '<\\/script')}\n}`).join(',\n');

const runtime = `
const modules = {${registry}};
const cache = {};
function get(id, from = '') {
  if(id === 'react') return window.React;
  if(id === 'react-dom/client') return window.ReactDOM;
  if(id.endsWith('.css')) return {};
  if(id.startsWith('.')) {
    const parts = from.split('/'); parts.pop();
    for(const part of id.split('/')) { if(part === '..') parts.pop(); else if(part !== '.') parts.push(part); }
    id = parts.join('/');
  }
  if(cache[id]) return cache[id].exports;
  if(!modules[id]) throw new Error('Module not found: '+id+' from '+from);
  const module = {exports:{}}; cache[id] = module;
  modules[id]((value)=>get(value,id),module,module.exports);
  return module.exports;
}
get('main');`;

const vendorBase = path.dirname(require.resolve('react/package.json'));
const react = fs.readFileSync(path.join(vendorBase, 'umd/react.production.min.js'), 'utf8');
const reactDom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js'), 'utf8');

const styleFiles = ['tokens.css', 'base.css', 'paper.css', 'components.css', 'home.css', 'workflow.css', 'reader.css', 'notes.css', 'settings.css', 'responsive.css', 'playful.css', 'kidmode.css'];
// Keep entry-point overrides (including focus mode and draft status) in the offline edition too.
const entryCss = fs.readFileSync(path.join(src, 'index.css'), 'utf8').replace(/^@import\s+[^;]+;\s*$/gm, '');
const css = [...styleFiles.map(file => fs.readFileSync(path.join(src, 'styles', file), 'utf8')), entryCss].join('\n');

let html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="开卷有灵 · 奇想纸艺世界视觉原型，所有内容为模拟"><title>开卷有灵 · 奇想纸艺世界</title><style>${css}</style></head><body><div id="root"></div><script>${react}</script><script>${reactDom}</script><script>${runtime}</script></body></html>`;
for (const [url, data] of Object.entries(art)) html = html.replaceAll(url, data);

const out = path.join(root, 'preview.html');
fs.writeFileSync(out, html);
console.log(`Transpiled ${Object.keys(modules).length} modules; wrote ${path.relative(process.cwd(), out)} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
