// Real temporary server/database, separate browser profiles. Only authentication and OCR are fixtures.
const {chromium}=require(process.env.PAPER_DRAFT_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
const BASE=process.env.PAPER_SYNC_TEST_URL||'http://127.0.0.1:8017';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHTkAAAAASUVORK5CYII=','base64');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 const errors=[];
 async function device(token='sync-a',user='sync-alice'){
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(t=>sessionStorage.setItem('AUTH_BEARER_TOKEN',t),token);
  await context.route('**/api/auth/me',r=>r.fulfill({json:{id:user,username:user,role:'user'}}));
  await context.route('**/api/ocr/**',r=>r.fulfill({json:{text:'乌龟一步一步走向终点。',confidence:0.9}}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(BASE);await page.locator('.workspace-draft-bar').getByText(/已同步到账号/).waitFor();
  return {context,page};
 }
 try{
  const a=await device();await a.page.goto(BASE+'/#/import');
  await a.page.getByPlaceholder('例如：森林里的来信').fill('跨设备测试书');
  await a.page.getByPlaceholder('例如：自制内容 / 赛事授权样本编号').fill('测试原创');
  // A generated real PNG avoids any external files or copyrighted book pages.
  const png=await a.page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=20;const ctx=c.getContext('2d');ctx.fillStyle='#90cf73';ctx.fillRect(0,0,20,20);return c.toDataURL('image/png').split(',')[1]});
  await a.page.locator('input[type=file]').setInputFiles([{name:'one.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')},{name:'two.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}]);
  await a.page.waitForFunction(()=>new URLSearchParams(location.hash.split('?')[1]).has('draft')); await a.page.waitForTimeout(1100); await a.page.locator('.draft-notice').getByRole('button',{name:'保存草稿'}).click(); await a.page.locator('.draft-notice').getByText(/已同步到账号/).waitFor();
  const id=new URLSearchParams(a.page.url().split('?')[1]).get('draft');assert(id);
  const b=await device();await b.page.getByRole('button',{name:'继续草稿'}).click();
  await b.page.getByPlaceholder('例如：森林里的来信').waitFor();assert.equal(await b.page.getByPlaceholder('例如：森林里的来信').inputValue(),'跨设备测试书');
  assert.equal(await b.page.locator('.page-preview img').count(),2);
  await b.page.getByPlaceholder('例如：森林里的来信').fill('第二设备更新');
  await b.page.locator('.draft-notice').getByRole('button',{name:'保存草稿'}).click(); await b.page.locator('.draft-notice').getByText(/已同步到账号/).waitFor();
  await a.page.getByPlaceholder('例如：森林里的来信').fill('旧设备冲突修改');
  await a.page.locator('.draft-notice').getByText(/其他设备已经更新/).waitFor();
  const remote=await a.page.request.get(BASE+'/api/library/drafts/'+id,{headers:{Authorization:'Bearer sync-a'}});assert.equal((await remote.json()).data.title,'第二设备更新');
  await a.context.close();
  await b.page.locator('input[type=checkbox]').check();
  await b.page.getByRole('button',{name:'确认导入预览'}).click();
  await b.page.getByRole('button',{name:'继续校对书页'}).click();
  await b.page.locator('.workspace-draft-bar').getByText(/已同步到账号/).waitFor();
  await b.page.waitForFunction(()=>location.hash.startsWith('#/review'));
  const response=await b.page.request.get(BASE+'/api/library/drafts/workspace',{headers:{Authorization:'Bearer sync-a'}});
  let saved=await response.json();assert.equal(saved.data.books.length,1);assert.equal(saved.data.books[0].pages.length,2);
  assert.equal(saved.data.books[0].title,'第二设备更新');
  assert.equal((await (await b.page.request.get(BASE+'/api/library/drafts',{headers:{Authorization:'Bearer sync-a'}})).json()).length,0);
  await b.context.close();
  await new Promise(r=>setTimeout(r,500));
  // Simulate a previously reviewed private workspace, without running a model.
  const freshContext=await browser.newContext();saved=await (await freshContext.request.get(BASE+'/api/library/drafts/workspace',{headers:{Authorization:'Bearer sync-a'}})).json();await freshContext.close();
  const book=saved.data.books[0];book.status='READY';book.safety_reviewed=true;book.classification.owner_confirmed=true;book.pages_only=true;book.reading_position={time_ms:18000,page_index:1,video:false};
  saved.data.notes=[{id:'private-note',book_id:book.id,title:'测试私密笔记',summary:'换设备后仍可继续编辑。',concepts:[],sources:[],review_status:'draft',visibility:'private',revision:1,reviewed_revision:null,updated_at:new Date().toISOString()}];
  const req=await browser.newContext();const edited=await req.request.put(BASE+'/api/library/drafts/workspace',{headers:{Authorization:'Bearer sync-a'},data:{expected_revision:saved.revision,data:saved.data}});assert.equal(edited.status(),200,await edited.text());await req.close();
  const c=await device();assert.equal(await c.page.getByRole('button',{name:/查看第二设备更新/}).count(),1);
  await c.page.goto(BASE+'/#/reader?book='+encodeURIComponent(book.id));
  await c.page.getByRole('heading',{name:'翻开故事，也打开好奇心。'}).waitFor();
  await c.page.waitForTimeout(1600);
  const check=await c.page.request.get(BASE+'/api/library/drafts/workspace',{headers:{Authorization:'Bearer sync-a'}});const checked=await check.json();assert.equal(checked.data.books[0].reading_position.page_index,1);
  await c.page.goto(BASE+'/#/notes?book='+encodeURIComponent(book.id));await c.page.locator('textarea').first().waitFor();
  assert((await c.page.locator('textarea').allTextContents()).join('').includes('换设备后仍可继续编辑。'));
  await c.context.close();
  const d=await device('sync-b','sync-bob');assert.equal(await d.page.getByRole('button',{name:/查看第二设备更新/}).count(),0);assert.equal(await d.page.getByRole('button',{name:'继续草稿'}).count(),0);await d.context.close();
  assert.deepEqual(errors,[]);console.log('PASS: real temp DB + independent browser profiles; originals, draft resume, conflict, import transfer, bookshelf, private note, reading page, account isolation; no paid model calls');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});


