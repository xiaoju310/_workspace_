// Browser integration test: all API calls intercepted; no user data written, no cloud billing.
const {chromium}=require(process.env.PAPER_DRAFT_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 try{
  const seed=await browser.newContext();const sp=await seed.newPage();
  await sp.goto('http://127.0.0.1:8000');await sp.getByLabel('运行模式').selectOption('demo');
  await sp.locator('.workspace-draft-bar').getByText(/本机草稿已保存/).waitFor();
  const fixture=await sp.evaluate(()=>JSON.parse(sessionStorage.getItem('paper-companion-full-v1:demo:demo')));await seed.close();
  fixture.books=[{...fixture.books[0],id:'workflow-ui-test',title:'图文工坊隔离测试',status:'READY',origin:'real',safety_reviewed:true,server_book_id:'book-workflow-test',run_id:'run-workflow-test',job_id:null,pages:fixture.books[0].pages.slice(0,2).map((p,i)=>({...p,server_page_no:i+1}))}];
  fixture.notes=[];fixture.grants=[];fixture.interactions=[];
  const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce',acceptDownloads:true});
  try{
   await context.addInitScript(data=>{sessionStorage.setItem('AUTH_BEARER_TOKEN','isolated-workflow-test');const key='paper-companion-full-v1:live:workflow-owner';if(!sessionStorage.getItem(key))sessionStorage.setItem(key,JSON.stringify(data))},fixture);
   const state={vision:null,storyboard:null,revision:0,approved:false,source_current:false,asset_id:null,tasks:[],events:[],clips:[],capabilities:{vision_configured:false,video_configured:true,composition_available:true}};
   const posts=[],errors=[],unexpected=[];
   await context.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
    assert.equal(req.headers().authorization,'Bearer isolated-workflow-test');
    if(path==='/api/library/drafts/workspace')return route.fulfill({json:req.method()==='PUT'?{revision:1}:{revision:1,data:fixture}});
    if(path==='/api/library/drafts')return route.fulfill({json:[]});
    if(path==='/api/library/books')return route.fulfill({json:[{id:fixture.books[0].server_book_id,pages:[],run:{id:fixture.books[0].run_id},notes:[]}]});
    if(path==='/api/auth/me')return route.fulfill({json:{id:'workflow-owner',username:'workflow-owner',role:'user'}});
    const prefix='/api/runs/run-workflow-test';
    if(path===prefix+'/workflow'&&method==='GET')return route.fulfill({json:state});
    if(path.startsWith(prefix+'/workflow/')&&method!=='GET'){
     const action=path.slice((prefix+'/workflow/').length);const data=req.postData()?req.postDataJSON():{};posts.push({action,data});
     if(action==='vision'){
      assert.deepEqual(data,{confirm_paid:true,page_nos:[1,2]});
      state.source_current=true;
      state.vision=[1,2].map(page_no=>({page_no,summary:`第${page_no}页乌龟行走`,scene:'森林小路',entities:[{name:'乌龟',description:'绿色背甲',confidence:.8}],events:['向前走'],uncertain:false}));
      state.revision=1;state.tasks=[{stage:'vision',job_id:'vision-job',status:'SUCCEEDED',error_code:null,error_message:null}];
     }else if(action==='storyboard'&&method==='POST'){
      state.storyboard={character_guide:'绿色背甲乌龟',shots:[1,2].map(page_no=>({page_no,caption:`第${page_no}页乌龟行走`,prompt:'温柔向前走'}))};state.revision=2;
     }else if(action==='storyboard'&&method==='PUT'){
      assert.equal(data.expected_revision,2);assert.equal(data.shots[0].caption,'主人修改后的故事');
      state.storyboard={character_guide:data.character_guide,shots:data.shots};state.revision=3;state.approved=false;
     }else if(action==='storyboard/approve'){
      assert.equal(data.expected_revision,3);state.approved=true;
     }else if(action==='video'){
      assert.equal(data.confirm_paid,true);assert.equal(state.approved,true);
      state.tasks.push({stage:'book_video',job_id:'book-video-job',status:'SUCCEEDED',error_code:null,error_message:null});
      state.asset_id='composed-video';state.clips=[1,2].map(page_no=>({page_no,downloaded:1,submitted:1}));
     }else throw Error('Unexpected mutation '+path);
     return route.fulfill({json:{ok:true}});
    }
    if(path===prefix+'/video')return route.fulfill({json:{status:'NOT_STARTED'}});
    if(path===prefix+'/assets')return route.fulfill({json:[]});
    if(path===prefix+'/segments')return route.fulfill({json:state.asset_id?[{id:'s1',run_id:'run-workflow-test',page_no:1,start_ms:0,end_ms:5000,caption:'主人修改后的故事',source:{producer:'book_storyboard'}},{id:'s2',run_id:'run-workflow-test',page_no:2,start_ms:5000,end_ms:10000,caption:'第2页',source:{producer:'book_storyboard'}}]:[]});
    if(path==='/api/books/book-workflow-test/notes/generate')return route.fulfill({status:201,json:{id:'visual-note',book_id:'book-workflow-test',owner_id:'workflow-owner',content:{title:'视觉笔记',summary:'主人修改后的故事\n\n第2页乌龟行走',concepts:['角色'],sources:[{page_no:1,quote:'主人修改后的故事',source:'reviewed_storyboard'}]},status:'DRAFT',version:1,created_at:'2026-11-16',updated_at:'2026-11-16'}});
    unexpected.push(method+' '+path);return route.fulfill({status:500,json:{detail:'Unexpected test request'}});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8000/#/reader?book=workflow-ui-test');
   let panel=page.getByRole('region',{name:'图文理解与分镜'});
   await panel.getByText(/尚未配置“视觉理解模型”/).waitFor();assert.equal(posts.length,0);
   let analyze=panel.getByRole('button',{name:'理解所选书页'});
   assert.equal(await analyze.isDisabled(),true);
   state.capabilities.vision_configured=true;
   await panel.getByRole('button',{name:'刷新进度'}).click();
   await panel.getByText(/尚未配置“视觉理解模型”/).waitFor({state:'hidden'});
   assert.equal(await analyze.isDisabled(),true);
   await panel.getByRole('checkbox',{name:/我同意将所选 2 页/}).check();
   await analyze.click();
   const make=panel.getByRole('button',{name:'根据书页分析整理分镜'});
   await panel.getByText('2 · 编辑和确认分镜（本步骤不收费）',{exact:true}).click();await make.waitFor({timeout:5000}).catch(async e=>{console.error(JSON.stringify({posts,state,panel:await panel.innerText(),unexpected}));throw e});
   await make.click();
   const captions=panel.getByRole('textbox',{name:'故事内容',exact:true});await captions.first().waitFor();
   await captions.first().fill('主人修改后的故事');
   const approve=panel.getByRole('button',{name:'我已检查内容，确认当前分镜'});
   assert.equal(await approve.isDisabled(),true);
   await panel.getByRole('button',{name:'保存分镜修改'}).click();
   await approve.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('我已检查内容，确认当前分镜')&&!b.disabled));
   await approve.click();await panel.getByRole('button',{name:'主人已确认当前分镜'}).waitFor();
   const video=panel.getByRole('button',{name:'按已确认分镜生成视频'});
   assert.equal(await video.isDisabled(),true);
   await panel.getByRole('checkbox',{name:/我确认分镜已经检查/}).check();await video.click();
   await panel.getByText(/已合成并保存/).waitFor();
   assert.equal(posts.filter(p=>p.action==='video').length,1);
   await panel.getByText('4 · 可选：开启豆包问答与点击认物',{exact:true}).click();
   await panel.getByRole('checkbox',{name:/我同意本次使用云端问答与认物/}).check();
   const exported=page.waitForEvent('download');await panel.getByRole('button',{name:'导出分析、分镜和流程记录'}).click();
   assert.ok((await exported).suggestedFilename().includes('reading-workflow'));
   const before=posts.length;await page.reload();
   panel=page.getByRole('region',{name:'图文理解与分镜'});await panel.getByText(/已合成并保存/).waitFor();assert.equal(posts.length,before);
   await panel.getByText('4 · 可选：开启豆包问答与点击认物',{exact:true}).click();
   assert.equal(await panel.getByRole('checkbox',{name:/我同意本次使用云端问答与认物/}).isChecked(),false);
   await page.getByRole('button',{name:/整理阅读笔记/}).click();
   await page.getByRole('textbox',{name:'笔记标题',exact:true}).waitFor();
   assert.equal(await page.getByRole('textbox',{name:'笔记标题',exact:true}).inputValue(),'视觉笔记');
   assert.ok((await page.getByRole('textbox',{name:'阅读摘要',exact:true}).inputValue()).includes('主人修改后的故事'));
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   console.log(JSON.stringify({ok:true,configurationGate:true,separateConsents:true,noAutomaticBilling:true,editBeforeApproval:true,revisionCheck:true,multiPageVideo:true,export:true,refreshNoDuplicate:true,cloudConsentReset:true,serverVisualNote:true,pageErrors:errors}));
  }finally{await context.close()}
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});




