// Isolated browser + intercepted API: never writes real data or calls paid models.
const {chromium}=require(process.env.PAPER_DRAFT_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 const errors=[];
 try{
  const seed=await browser.newContext();const sp=await seed.newPage();
  await sp.goto('http://127.0.0.1:8000');await sp.getByLabel('运行模式').selectOption('demo');
  await sp.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  const fixture=await sp.evaluate(()=>JSON.parse(sessionStorage.getItem('paper-companion-full-v1:demo:demo')));await seed.close();
  fixture.books=[{...fixture.books[0],id:'video-ui-test',title:'视频隔离测试',status:'READY',origin:'real',safety_reviewed:true,server_book_id:'book-video-test',run_id:'run-video-test',job_id:null,pages:fixture.books[0].pages.map((p,i)=>({...p,server_page_no:i+1}))}];
  fixture.notes=[];fixture.grants=[];fixture.interactions=[];
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  try{
   await context.addInitScript(data=>{sessionStorage.setItem('AUTH_BEARER_TOKEN','isolated-video-test');const key='paper-companion-full-v1:live:video-owner';if(!sessionStorage.getItem(key))sessionStorage.setItem(key,JSON.stringify(data))},fixture);
   let state={status:'NOT_STARTED'},posts=0,resumes=0,assetReads=0,failedOnce=true,release;
   let hold=new Promise(resolve=>{release=resolve});
   const sample=process.env.PAPER_VIDEO_SAMPLE;
   const content=sample?fs.readFileSync(sample):Buffer.from('\x00\x00\x00\x18ftypisom');
   await context.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    assert.equal(req.headers().authorization,'Bearer isolated-video-test');
    if(path==='/api/library/drafts/workspace')return route.fulfill({json:req.method()==='PUT'?{revision:1}:{revision:1,data:fixture}});
    if(path==='/api/library/drafts')return route.fulfill({json:[]});
    if(path==='/api/library/books')return route.fulfill({json:[{id:fixture.books[0].server_book_id,pages:[],run:{id:fixture.books[0].run_id},notes:[]}]});
    if(path==='/api/auth/me')return route.fulfill({json:{id:'video-owner',username:'video-owner',role:'user'}});
    if(path==='/api/runs/run-video-test/workflow')return route.fulfill({json:{vision:null,storyboard:null,revision:0,approved:false,source_current:true,asset_id:null,tasks:[],clips:[],capabilities:{vision_configured:false,video_configured:true,composition_available:true}}});
    if(path==='/api/runs/run-video-test/video'){
     if(req.method()==='POST'){
      posts++;const body=req.postDataJSON();assert.equal(body.confirm_paid,true);assert.equal(body.page_no,2);assert.equal(body.duration,5);
      if(failedOnce){failedOnce=false;return route.fulfill({status:503,json:{detail:'模拟连接中断，请重新查询'}})}
      await hold;state={status:'RUNNING',page_no:2,job_id:'video-job'};return route.fulfill({status:202,json:state});
     }
     return route.fulfill({json:state});
    }
    if(path==='/api/runs/run-video-test/video/resume'){
     resumes++;state={status:'SUCCEEDED',page_no:2,job_id:'video-job',asset_id:'video-asset'};
     return route.fulfill({status:202,json:state});
    }
    if(path==='/api/runs/run-video-test/assets')return route.fulfill({json:state.status==='SUCCEEDED'?[{id:'video-asset',run_id:'run-video-test',asset_type:'video',mime_type:'video/mp4',sha256:'mock-hash-test',duration_ms:5000,created_at:'2026-11-16'}]:[]});
    if(path==='/api/runs/run-video-test/assets/video-asset/content'){assetReads++;return route.fulfill({body:content,contentType:'video/mp4'})}
    if(path==='/api/runs/run-video-test/segments')return route.fulfill({json:state.status==='SUCCEEDED'?[{id:'seg',run_id:'run-video-test',page_no:2,start_ms:0,end_ms:5000,caption:'test',source:{producer:'test'}}]:[]});
    return route.fulfill({status:500,json:{detail:'Unexpected isolated test request: '+path}});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8000/#/reader?book=video-ui-test');
   const panel=page.getByRole('region',{name:'豆包视频生成'}),generate=panel.getByRole('button',{name:'生成单页视频'});
   await generate.waitFor();assert.equal(posts,0);
   await generate.click();const dialog=page.getByRole('dialog',{name:'确认生成一段短片？'});
   assert.equal(await dialog.getByRole('button',{name:'确认并生成'}).isDisabled(),true);
   await page.waitForFunction(()=>document.querySelector('dialog[open] .book-delete-keep')===document.activeElement);
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(posts,0);
   await generate.click();await page.getByLabel('视频来源书页').selectOption('2');
   await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'确认并生成'}).click();
   await dialog.getByRole('alert').filter({hasText:'模拟连接中断'}).waitFor();assert.equal(await dialog.isVisible(),true);
   await dialog.getByRole('button',{name:'确认并生成'}).click();
   await dialog.getByRole('button',{name:'正在提交…'}).waitFor();
   await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);
   assert.equal(await dialog.getByRole('button',{name:'暂不生成'}).isDisabled(),true);
   release();await dialog.waitFor({state:'hidden'});await panel.getByText(/豆包正在生成视频/).waitFor();
   assert.equal(posts,2);await page.reload();await panel.getByText(/豆包正在生成视频/).waitFor();assert.equal(posts,2);
   state={status:'FAILED',page_no:2,job_id:'video-job',can_resume:true,error_message:'模拟等待超时'};
   await panel.getByRole('button',{name:'刷新视频状态'}).click();
   await panel.getByRole('button',{name:'继续查询原任务（不重新生成）'}).click();
   await panel.getByText(/短片已保存到服务器/).waitFor();
   await page.locator('[data-video-status="ready"]').waitFor();
   assert.equal(resumes,1);assert.equal(posts,2);assert.ok(assetReads>0);
   assert.ok((await page.locator('video').getAttribute('src')).startsWith('blob:'));
   if(sample)await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
   await page.reload();await panel.getByText(/短片已保存到服务器/).waitFor();assert.equal(posts,2);
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({ok:true,noAutomaticPaidSubmit:true,consentRequired:true,cancelFocus:true,escape:true,selectedPage:true,submitFailureVisible:true,pendingLocked:true,refreshRetainsTask:true,resumeDoesNotSubmit:true,assetReload:true,blobVideo:true,actualMp4Metadata:!!sample,pageErrors:errors}));
  }finally{await context.close()}
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
