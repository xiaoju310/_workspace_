const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const src = path.join(root, 'frontend/src');
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
for (const file of fs.readdirSync(path.join(root, 'frontend/public/art'))) {
  art[`/art/${file}`] = `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'frontend/public/art', file)).toString('base64')}`;
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
const css = ['global.css','workspace.css','workflow.css','reader.css','notes.css'].map(file => fs.readFileSync(path.join(src,'styles',file),'utf8')).join('\n');
let html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="纸书智伴全流程离线交互原型，所有内容为模拟"><title>纸书智伴 · 全流程演示</title><style>${css}</style></head><body><div id="root"></div><script>${react}</script><script>${reactDom}</script><script>${runtime}</script></body></html>`;
for(const [url, data] of Object.entries(art)) html = html.replaceAll(url, data);
fs.mkdirSync(path.join(root, 'docs/prototype'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/prototype/paper-companion-full.html'), html);
console.log(`Transpiled ${Object.keys(modules).length} TypeScript modules; generated self-contained offline HTML (${Math.round(Buffer.byteLength(html)/1024)} KB).`);


