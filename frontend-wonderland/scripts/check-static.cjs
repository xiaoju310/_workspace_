// 无浏览器环境下的静默校验：
// 1) 每个被 require 的相对模块都能在打包结果里找到（找不到会导致离线页白屏）
// 2) 每个在 TSX 里使用的 className 都能在 CSS 里找到对应选择器（找不到说明漏了样式）
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');

const files = [];
(function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(full) && !full.endsWith('.d.ts') && !full.includes('__tests__')) files.push(full);
  }
})(src);

const ids = new Set();
const codeById = new Map();
const sourceById = new Map();
for (const file of files) {
  const id = path.relative(src, file).replaceAll('\\', '/').replace(/\.tsx?$/, '');
  const text = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(text, {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, isolatedModules: true },
  }).outputText;
  ids.add(id);
  codeById.set(id, out);
  sourceById.set(id, text);
}

/** 复刻离线 runtime 的相对路径解析规则 */
function resolveId(request, from) {
  if (!request.startsWith('.')) return request;
  const parts = from.split('/');
  parts.pop();
  for (const part of request.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

const missingModules = [];
for (const [id, code] of codeById) {
  const requires = [...code.matchAll(/require\((?:"|')([^"']+)(?:"|')\)/g)].map(match => match[1]);
  for (const request of requires) {
    const target = resolveId(request, id);
    const ok = target === 'react' || target === 'react-dom/client' || ids.has(target) || target.endsWith('.css');
    if (!ok) missingModules.push(`${id} -> ${request}`);
  }
}

/** 抽取 TSX 中静态可确定的 className */
const usedClasses = new Set();
const dynamicPrefixes = new Set();
for (const text of sourceById.values()) {
  const patterns = [/className="([^"]*)"/g, /className=\{`([^`]*)`\}/g, /className=\{'([^']*)'\}/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const raw of match[1].split(/\s+/)) {
        const token = raw.trim().replace(/^['"]|['"]$/g, '');
        if (!token) continue;
        if (token.includes('${')) {
          const prefix = token.split('${')[0];
          if (prefix) dynamicPrefixes.add(prefix);
          continue;
        }
        // 只统计真正的静态类名；其余是模板字符串里的表达式碎片
        if (!/^[a-zA-Z][\w-]*$/.test(token)) continue;
        usedClasses.add(token);
      }
    }
  }
  // className={`a ${x ? 'b' : 'c'}`} 里三元两侧的类名
  for (const match of text.matchAll(/className=\{`[^`]*`\}/g)) {
    for (const literal of match[0].matchAll(/'([a-zA-Z][\w-]*)'/g)) usedClasses.add(literal[1]);
  }
}

const cssFiles = fs.readdirSync(path.join(src, 'styles')).filter(name => name.endsWith('.css'));
const css = cssFiles.map(name => fs.readFileSync(path.join(src, 'styles', name), 'utf8')).join('\n') +
  fs.readFileSync(path.join(src, 'index.css'), 'utf8');
const definedClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => match[1]));

const missingStyles = [...usedClasses].filter(name => !definedClasses.has(name) && !dynamicPrefixes.has(name)).sort();

console.log(`modules: ${ids.size}, missing references: ${missingModules.length}`);
if (missingModules.length) console.log(missingModules.map(item => `  MISSING ${item}`).join('\n'));
console.log(`classNames used: ${usedClasses.size}, styles defined: ${definedClasses.size}`);
console.log(`unstyled classNames: ${missingStyles.length}`);
if (missingStyles.length) console.log('  ' + missingStyles.join('\n  '));
process.exit(missingModules.length ? 1 : 0);
