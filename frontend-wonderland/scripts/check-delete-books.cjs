const {chromium}=require(process.env.PAPER_DRAFT_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const errors=[];
 try{
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8000');await page.getByLabel('运行模式').selectOption('demo');
  await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  const buddy=page.locator('.buddy-owl .owl-mascot');
  assert.equal(await buddy.evaluate(el=>Math.round(el.getBoundingClientRect().width)),152);
  await page.getByRole('button',{name:'收起猫头鹰的提示',exact:true}).click();assert.equal(await page.locator('.buddy-bubble').count(),0);
  await page.getByRole('button',{name:'让伴读猫头鹰再说话',exact:true}).click();await page.locator('.buddy-bubble').waitFor();
  await page.locator('.buddy-owl').dblclick();await page.getByRole('button',{name:'把猫头鹰叫回来'}).click();await buddy.waitFor();
  await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'paper-reading-owl-larger.png')});
  const liveFixture=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('paper-companion-full-v1:demo:demo')));
  const first=page.getByRole('button',{name:'删除《森林里的来信》',exact:true});
  assert.equal(await first.count(),1);
  assert.equal(await page.getByRole('button',{name:'删除《一颗种子的旅行》',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('button button').count(),0);
  const modal=page.getByRole('dialog',{name:'要和这本书告别吗？'});
  // Opening is safe: cancel has focus, Escape and the explicit cancel both preserve the book.
  await first.click();await modal.waitFor();
  assert.equal(await modal.getByRole('button',{name:'先留着',exact:true}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await modal.getByText('删除后无法恢复',{exact:true}).isVisible(),true);
  await page.keyboard.press('Tab');assert.equal(await modal.evaluate(el=>el.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
  assert.equal(await first.evaluate(el=>el===document.activeElement),true);
  await first.click();await modal.getByRole('button',{name:'先留着',exact:true}).click();await modal.waitFor({state:'hidden'});assert.equal(await first.count(),1);
  await first.click();await modal.getByRole('button',{name:'关闭删除确认'}).click();await modal.waitFor({state:'hidden'});
  // Check keyboard focus containment and screenshots at desktop / narrow sizes without real data.
  await first.click();
  await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'paper-book-delete-dialog.png')});
  for(const width of [390,768,1280]){
    await page.setViewportSize({width,height:900});
    const bounds=await modal.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await modal.getByRole('button',{name:'确认删除',exact:true}).click();await first.waitFor({state:'detached'});await modal.waitFor({state:'hidden'});
  assert.equal(await page.getByText('关于勇气与友谊的三个发现',{exact:true}).count(),0);
  await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  await page.reload();await page.getByLabel('运行模式').selectOption('demo');
  await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  assert.equal(await page.getByRole('button',{name:'删除《森林里的来信》',exact:true}).count(),0);
  const moon=page.getByRole('button',{name:'删除《月亮邮局》',exact:true});
  await moon.scrollIntoViewIfNeeded();await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'paper-book-delete-shelf.png')});
  await moon.click();await modal.getByRole('button',{name:'确认删除',exact:true}).click();await moon.waitFor({state:'detached'});
  await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  // Only this fresh test context: mark the demo seed task finished to exercise deletion of the final book.
  await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('paper-companion-drafts-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),r=store.getAll();r.onsuccess=()=>{for(const record of r.result){if(record.id==='workspace'){record.data.books.forEach(b=>b.status='REVIEW_REQUIRED');store.put(record)}}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  });
  await page.reload();await page.getByLabel('运行模式').selectOption('demo');
  const seed=page.getByRole('button',{name:'删除《一颗种子的旅行》',exact:true});await seed.waitFor();
  await seed.click();await modal.getByRole('button',{name:'确认删除',exact:true}).click();await seed.waitFor({state:'detached'});
  await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  await page.reload();await page.getByLabel('运行模式').selectOption('demo');
  await page.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  assert.equal(await page.locator('.book-delete-button').count(),0);
  assert.equal(await page.locator('.book-card').count(),0);
  await page.getByRole('button',{name:'导入一本书'}).click();await page.getByPlaceholder('例如：森林里的来信').waitFor();
  // A separate fresh context verifies the Live transport and failure UI without touching real records.
  const live=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  try{
    const fixture=liveFixture;fixture.books=[{...fixture.books[0],id:'live-delete-test',server_book_id:'server-delete-test',run_id:null,job_id:null}];fixture.notes=[];fixture.grants=[];fixture.interactions=[];
    await live.addInitScript(data=>{sessionStorage.setItem('AUTH_BEARER_TOKEN','isolated-ui-test-only');if(!sessionStorage.getItem('paper-companion-full-v1:live:test-owner'))sessionStorage.setItem('paper-companion-full-v1:live:test-owner',JSON.stringify(data))},fixture);
    let fail=true,deletes=0;let releaseDelete;let holdDelete;
    await live.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname;
      if(path==='/api/auth/me')return route.fulfill({json:{id:'test-owner',username:'test-owner',role:'user'}});
      if(path==='/api/books/server-delete-test'&&req.method()==='DELETE'){
        assert.equal(req.headers().authorization,'Bearer isolated-ui-test-only');deletes++;if(holdDelete)await holdDelete;
        return fail?route.fulfill({status:409,json:{detail:'这本书正在生成，请等待任务结束后再删除'}}):route.fulfill({status:204});
      }
      return route.fulfill({status:500,json:{detail:'Unexpected test request'}});
    });
    const lp=await live.newPage();lp.on('pageerror',e=>errors.push(e.message));await lp.goto('http://127.0.0.1:8000');
    const remove=lp.getByRole('button',{name:'删除《森林里的来信》',exact:true});await remove.waitFor();
    const liveModal=lp.getByRole('dialog',{name:'要和这本书告别吗？'});
    await remove.click();await liveModal.getByRole('button',{name:'确认删除',exact:true}).click();await liveModal.getByRole('alert').filter({hasText:'删除失败'}).waitFor();assert.equal(await remove.count(),1);
    // Retry stays inside the dialog; while pending it cannot be dismissed or double-submitted.
    fail=false;holdDelete=new Promise(resolve=>{releaseDelete=resolve});
    await liveModal.getByRole('button',{name:'确认删除',exact:true}).click();
    await liveModal.getByRole('button',{name:'正在删除…',exact:true}).waitFor();
    assert.equal(await liveModal.getByRole('button',{name:'先留着',exact:true}).isDisabled(),true);
    assert.equal(await liveModal.getByRole('button',{name:'关闭删除确认'}).isDisabled(),true);
    await lp.keyboard.press('Escape');assert.equal(await liveModal.isVisible(),true);
    releaseDelete();await remove.waitFor({state:'detached'});assert.equal(deletes,2);await liveModal.waitFor({state:'hidden'});
    await lp.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();await lp.reload();await lp.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();assert.equal(await lp.locator('.book-delete-button').count(),0);
  }finally{await live.close()}
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,cancel:true,focusRestored:true,escape:true,responsiveDialog:true,largerBuddy:true,buddyInteractions:true,pendingCannotDismiss:true,confirm:true,refresh:true,relatedNoteRemoved:true,generatingBlocked:true,lastBookStaysDeleted:true,canImportAfterEmpty:true,liveFailureKeepsBook:true,liveSuccessPersists:true,pageErrors:errors}));
 }finally{await context.close();await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
