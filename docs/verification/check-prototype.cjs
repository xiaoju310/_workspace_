const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: {width:1366,height:1000}, deviceScaleFactor:1 });
  const errors=[]; const checks=[]; const requests=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('request',req=>{if(/^https?:/.test(req.url())) requests.push(req.url())});
  await page.goto('file:///'+path.resolve(__dirname,'../../docs/prototype/paper-companion-d1.html').replaceAll('\\','/'));
  await page.getByRole('heading',{name:'今天，翻开哪个世界？'}).waitFor();
  const screenshot=async name=>page.screenshot({path:path.resolve(__dirname,`../../docs/screenshots/${name}.png`),fullPage:true});
  const check=async(name,fn)=>{await fn();checks.push({name,result:'PASS'})};
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await check('1366px 首页布局无横向溢出',noOverflow); await screenshot('d1-home-1366');
  await check('书名搜索与无结果恢复',async()=>{await page.getByRole('searchbox').fill('找不到的书');await page.getByRole('heading',{name:'还没有找到这本书'}).waitFor();await page.getByRole('button',{name:'清除筛选'}).click();assert.equal(await page.locator('.book-card').count(),3)});
  await check('类型筛选',async()=>{await page.getByRole('button',{name:'知识读物',exact:true}).click();assert.equal(await page.locator('.book-card').count(),1);await page.getByRole('button',{name:'全部图书',exact:true}).click()});
  await check('低置信度和主人确认状态',async()=>{await page.getByRole('button',{name:'查看月亮邮局，待确认'}).click();await page.getByText('置信度较低，需要主人确认或修改类型。').waitFor();await page.getByRole('button',{name:'返回阅读空间'}).click()});
  await check('笔记草稿和私密预览',async()=>{await page.locator('.note-card').nth(1).click();await page.getByText('尚未通过主人审核，暂不能分享。').waitFor();await page.keyboard.press('Escape')});
  await check('首页加载、空数据、失败和重试',async()=>{await page.getByLabel('原型状态').selectOption('loading');await page.getByRole('heading',{name:'正在整理书架'}).waitFor();await page.getByLabel('原型状态').selectOption('empty');await page.getByRole('heading',{name:'把第一本好书带进来'}).waitFor();await page.getByLabel('原型状态').selectOption('error');await page.getByRole('heading',{name:'书架暂时没有打开'}).waitFor();await page.getByRole('button',{name:'重新加载'}).click();assert.equal(await page.locator('.book-card').count(),3)});
  await page.getByRole('button',{name:'导入一本书'}).click(); await page.locator('.upload-dropzone').waitFor();
  await check('1366px 上传页布局无横向溢出',noOverflow);await screenshot('d1-import-1366');
  await check('必填和授权缺失时阻止导入',async()=>{await page.getByRole('button',{name:'确认导入预览'}).click();await page.getByText('请填写图书名称。',{exact:true}).waitFor();await page.getByText('请至少选择一张书页。',{exact:true}).waitFor()});await screenshot('d1-import-error-1366');
  await check('拒绝格式错误和损坏图片',async()=>{await page.locator('input[type=file]').setInputFiles([{name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('bad')},{name:'broken.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,1])}]);await page.getByText('bad.txt：仅支持 JPG / PNG 图片。',{exact:true}).waitFor();await page.getByText('broken.png：图片损坏或无法解码，请重新导出。',{exact:true}).waitFor()});
  await check('拒绝超过 10 MB 的图片',async()=>{await page.locator('input[type=file]').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(10*1024*1024+1)});await page.getByText('large.png：超过 10 MB，请压缩后重试。',{exact:true}).waitFor()});
  await check('有效 PNG 本地预览',async()=>{await page.locator('input[type=file]').setInputFiles({name:'valid.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBFkAAAAASUVORK5CYII=','base64')});await page.locator('.page-list li').waitFor();assert.equal(await page.locator('.page-list li').count(),1)});
  await check('原创示例、页序调整和移除',async()=>{await page.getByRole('button',{name:'试用原创示例'}).click();assert.equal(await page.locator('.page-list li').count(),3);await page.getByRole('button',{name:'将第 2 页前移'}).click();assert.match(await page.locator('.page-file strong').first().textContent(),/-02\.png$/);await page.getByRole('button',{name:'移除第 3 页'}).click();assert.equal(await page.locator('.page-list li').count(),2)});
  await check('授权确认后本地模拟成功，无网络传输',async()=>{await page.getByRole('checkbox').check();await page.getByRole('button',{name:'确认导入预览'}).click();await page.getByText('导入预览已确认',{exact:true}).waitFor();await page.getByText('《森林里的来信》· 2 页。当前只完成本地模拟，下一步是校对与分类确认。').waitFor();assert.equal(requests.length,0)});await screenshot('d1-import-success-1366');
  await check('返回修改及导入页四状态',async()=>{await page.getByRole('button',{name:'返回修改'}).click();await page.getByLabel('原型状态').selectOption('loading');await page.getByRole('status').waitFor();await page.getByLabel('原型状态').selectOption('error');await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'重新加载'}).click();await page.getByLabel('原型状态').selectOption('empty');await page.waitForFunction(()=>document.querySelectorAll('.page-list li').length===0);assert.equal(await page.locator('.page-list li').count(),0)});
  await check('1024px 平板首页与导入无溢出',async()=>{await page.setViewportSize({width:1024,height:900});await page.getByRole('link',{name:'首页',exact:true}).click();await noOverflow();await screenshot('d1-home-1024');await page.getByRole('button',{name:'导入一本书'}).click();await noOverflow();await screenshot('d1-import-1024')});
  await check('390px 移动端首页与导入无溢出',async()=>{await page.setViewportSize({width:390,height:844});await page.getByRole('link',{name:'首页',exact:true}).click();await noOverflow();await screenshot('d1-home-390');await page.getByRole('button',{name:'导入一本书'}).click();await noOverflow();await screenshot('d1-import-390')});
  await check('未出现脚本错误或远程请求',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(requests,[])});
  const report={date:'2026-11-04',browser:await browser.version(),mode:'Edge headless，file:// 离线 React 原型',checks,errors,remoteRequests:requests,limitations:['Vite 依赖安装受网络沙箱限制，npm 构建未运行','离线预览使用本机已有 React/ReactDOM 18.3.1 与 TypeScript 5.9.3 转译','后端、OCR、分类、视频、审核和分享服务尚未接入','尚未在真实平板设备和原生 Figma 文件中验收']};
  fs.writeFileSync(path.resolve(__dirname,'../../docs/test-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});


