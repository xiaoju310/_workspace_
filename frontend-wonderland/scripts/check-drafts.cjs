const { chromium } = require(process.env.PAPER_DRAFT_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const profile=fs.mkdtempSync(path.join(os.tmpdir(),'paper-draft-test-'));const options={channel:'msedge',headless:true,args:['--disable-gpu']};
 const errors=[];let context;const state={};const profileCleanup=()=>fs.rmSync(profile,{recursive:true,force:true});
 async function start(){context=await chromium.launchPersistentContext(profile,options);const page=context.pages()[0]??await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8000');await page.getByLabel('运行模式').selectOption('demo');await page.getByText(/本机草稿已保存/).waitFor();return page}
 try{
  let page=await start();await page.getByRole('button',{name:'导入一本书'}).click();await page.getByPlaceholder('例如：森林里的来信').fill('后台草稿恢复验收');await page.getByPlaceholder('例如：自制内容 / 赛事授权样本编号').fill('自制测试图片');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  await page.locator('input[type=file]').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:png},{name:'second.png',mimeType:'image/png',buffer:png}]);
  await page.getByText('first.png',{exact:true}).waitFor();
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.locator('.draft-notice').getByText(/本机草稿已保存/).waitFor();
  state.draftUrl=page.url();assert(state.draftUrl.includes('draft='));
  await page.reload();await page.getByLabel('运行模式').selectOption('demo');await page.getByPlaceholder('例如：森林里的来信').waitFor();assert.equal(await page.getByPlaceholder('例如：森林里的来信').inputValue(),'后台草稿恢复验收');assert.equal(await page.locator('.page-list > li').count(),2);
  // 先确认恢复图像确实可解码，非仅有书名和失效链接。
  assert.equal(await page.locator('.page-preview img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);
  await page.getByRole('button',{name:/返回首页/}).click();await page.getByRole('button',{name:'继续草稿',exact:true}).waitFor();
  await context.close();
  page=await start();await page.getByRole('button',{name:'继续草稿',exact:true}).click();await page.getByPlaceholder('例如：森林里的来信').waitFor();assert.equal(await page.getByPlaceholder('例如：森林里的来信').inputValue(),'后台草稿恢复验收');assert.equal(await page.locator('.page-list > li').count(),2);state.reopen=true;
  await page.getByRole('button',{name:'将第 2 页前移',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'确认导入预览',exact:true}).click();await page.getByRole('button',{name:/继续校对书页/}).click();await page.locator('#ocr-text').waitFor();
  await page.locator('#ocr-text').fill('这是没有手动保存校对的草稿文字');await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  await page.reload();await page.getByLabel('运行模式').selectOption('demo');await page.locator('#ocr-text').waitFor();assert.equal(await page.locator('#ocr-text').inputValue(),'这是没有手动保存校对的草稿文字');state.unsavedOcr=true;
  assert.equal(await page.locator('.original-image img').evaluate(i=>i.complete&&i.naturalWidth>0),true);state.image=true;
  await page.getByRole('button',{name:'保存校对',exact:true}).click();await page.getByRole('button',{name:'确认此页',exact:true}).click();await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  await context.close();page=await start();assert.equal(await page.getByRole('button',{name:'继续草稿',exact:true}).count(),0);await page.getByRole('button',{name:/查看后台草稿恢复验收/}).click();await page.locator('#ocr-text').waitFor();assert.equal(await page.locator('#ocr-text').inputValue(),'这是没有手动保存校对的草稿文字');state.bookshelf=true;
  await page.goto('http://127.0.0.1:8000/#/');await page.getByLabel('运行模式').selectOption('demo');await page.getByRole('button',{name:'导入一本书'}).waitFor();await page.getByRole('button',{name:'导入一本书'}).click();await page.getByPlaceholder('例如：森林里的来信').fill('要删除的草稿');await page.locator('.draft-notice').getByText(/本机草稿已保存/).waitFor();await page.getByRole('button',{name:/返回首页/}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'删除草稿',exact:true}).click();await page.getByRole('button',{name:'继续草稿',exact:true}).waitFor({state:'detached'});state.deleted=true;
  state.refresh=true;
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,state,errors}));
 }finally{await context?.close();profileCleanup()}
})().catch(e=>{console.error(e);process.exitCode=1});
