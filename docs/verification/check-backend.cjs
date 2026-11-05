// 使用临时数据库/随机令牌启动 A 的真实服务，绝不读取或修改开发数据库。
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createRequire}=require('node:module');
const {spawn}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const net=require('node:net');
const root=path.resolve(__dirname,'../..');
const requireFrontend=createRequire(path.join(root,'frontend/package.json'));
const {chromium}=require('playwright');
const python=process.env.VERIFY_PYTHON||path.join(root,'backend/.venv/Scripts/python.exe');
const base='http://127.0.0.1:18765';
const ui='http://127.0.0.1:15173';
const token=randomUUID(),otherToken=randomUUID();
const checks=[];
let backend,browser,viteServer;
async function freePort(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve))})}
async function check(name,fn){await fn();checks.push({name,result:'PASS'});console.log('PASS '+name)}
async function terminalJob(api,jobId){let result;for(let i=0;i<50;i++){result=await api.getJob(jobId);if(!['QUEUED','RUNNING','RETRYING'].includes(result.status))return result;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('任务未在验证时限内结束')}
(async()=>{
 await freePort(18765);await freePort(15173);
 backend=spawn(python,['-B',path.join(__dirname,'isolated-backend.py')],{cwd:root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',APP_USER_TOKENS:JSON.stringify({'test-owner':token,'test-other':otherToken}),VERIFY_API_PORT:'18765'},stdio:['ignore','ignore','pipe']});
 let startup='';backend.stderr.on('data',chunk=>startup+=String(chunk));
 backend.on('error',error=>startup=error.message);
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){try{const response=await fetch(base+'/health');if(response.ok){ready=true;break}}catch{}if(backend.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100))}
 if(!ready)throw new Error('隔离后端未启动：'+startup.replaceAll(token,'[redacted]').replaceAll(otherToken,'[redacted]'));
 const ts=requireFrontend('typescript');
 const source=fs.readFileSync(path.join(root,'frontend/src/api/client.ts'),'utf8');
 const exportsObj={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObj,URL,Headers,Blob,AbortController,setTimeout,clearTimeout,fetch});
 const api=exportsObj.createApiClient(base,{getToken:()=>token});
 const unauthorized=exportsObj.createApiClient(base,{getToken:()=>randomUUID()});
 const other=exportsObj.createApiClient(base,{getToken:()=>otherToken});
 // 8x8 PNG，自制纯色测试图片。
 const {PNG}=require('pngjs');const png=new PNG({width:8,height:8});png.data.fill(255);const image=PNG.sync.write(png);
 let book,job;
 await check('实际后端健康、401 与 422',async()=>{assert.equal((await api.health()).status,'ok');await assert.rejects(()=>unauthorized.createBook({title:'联调',authorization_ref:'original'}),e=>e.status===401);await assert.rejects(()=>api.createBook({title:'',authorization_ref:'original'}),e=>e.status===422&&e.message.includes('title'))});
 await check('实际建书 id、原图上传与 SHA-256 一致',async()=>{book=await api.createBook({title:'自制联调绘本',authorization_ref:'verification-original'});assert.ok(book.id);const uploaded=await api.uploadPage(book.id,new Blob([image],{type:'image/png'}),1);assert.equal(uploaded.sha256,createHash('sha256').update(image).digest('hex'));assert.equal((await api.listPages(book.id)).length,1)});
 await check('实际重复页 409、坏图片 415 与跨用户 404',async()=>{await assert.rejects(()=>api.uploadPage(book.id,new Blob([image],{type:'image/png'}),1),e=>e.status===409);await assert.rejects(()=>api.uploadPage(book.id,new Blob(['bad'],{type:'image/png'}),2),e=>e.status===415);await assert.rejects(()=>other.getBook(book.id),e=>e.status===404)});
 await check('实际分类确认与人工校对版本',async()=>{const classification=await api.classifyBook(book.id);assert.ok(classification.predicted_type);assert.equal((await api.confirmClassification(book.id,'picture_book')).status,'CONFIRMED');const revision=await api.updatePage(book.id,1,{ocr:{text:'人工校对示例'}});assert.equal(revision.ocr.text,'人工校对示例');assert.equal(revision.source,'manual_review');assert.equal((await api.pageRevisions(book.id,1)).length,1)});
 await check('实际分析缺模型失败、错误码与笔记拒绝',async()=>{job=await api.analyzeBook(book.id);assert.equal((await terminalJob(api,job.job_id)).status,'FAILED');assert.equal((await api.progress(job.run_id)).stages[0].error_code,'PROVIDER_NOT_CONFIGURED');assert.equal((await api.runJobs(job.run_id))[0].error_message,'尚未接入真实分析服务');await assert.rejects(()=>api.generateNote(book.id),e=>e.status===409)});
 await check('实际最多三次尝试，重试超限 409',async()=>{for(let i=0;i<2;i++){await api.retryJob(job.job_id);await terminalJob(api,job.job_id)}assert.equal((await api.getJob(job.job_id)).attempts,3);await assert.rejects(()=>api.retryJob(job.job_id),e=>e.status===409)});
 const vite=await import(pathToFileURL(requireFrontend.resolve('vite')).href);
 viteServer=await vite.createServer({root:path.join(root,'frontend'),logLevel:'error',server:{host:'127.0.0.1',port:15173,strictPort:true,proxy:{'/backend-api':{target:base,changeOrigin:true,rewrite:value=>value.replace(/^\/backend-api/,'')}}}});await viteServer.listen();
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1366,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(ui+'/#/settings');
 const workbench=page.locator('.backend-workbench');
 await check('页面真实联调：代理、Bearer、建书上传、分类和校对',async()=>{
  await workbench.getByLabel('本地 Bearer 令牌').fill(token);
  await workbench.getByLabel('联调图书名称').fill('前端实际联调绘本');await workbench.getByLabel('联调素材来源').fill('自制测试');await workbench.getByRole('checkbox').check();
  await workbench.getByLabel('选择联调 JPG/PNG').setInputFiles({name:'self-made.png',mimeType:'image/png',buffer:image});
  await workbench.getByText('已检查 1 张图片，将按下方顺序发送原始字节。',{exact:true}).waitFor();
  await workbench.getByRole('button',{name:'建书并上传原始图片',exact:true}).click();await workbench.getByText(/服务器已接收 1 页原始图片/).waitFor();
  await workbench.getByRole('button',{name:'读取后端分类',exact:true}).click();await workbench.getByLabel('确认服务端类型').waitFor();
  await workbench.getByRole('button',{name:'保存服务端类型确认'}).click();await workbench.getByText('图书类型已保存到 A 后端。',{exact:true}).waitFor();
  await workbench.getByLabel('人工校对文字').fill('前端人工校对');await workbench.getByRole('button',{name:'保存到 A 的校对接口'}).click();await workbench.getByText(/来源 manual_review/).waitFor();
 });
 await check('页面保留真实失败，不混入模拟成功',async()=>{await workbench.getByRole('button',{name:'发起 A 的分析任务'}).click();await workbench.getByRole('alert').filter({hasText:'PROVIDER_NOT_CONFIGURED'}).waitFor();assert.match(await workbench.locator('.backend-id').last().textContent(),/FAILED/);assert.equal(await page.locator('.demo-mode-banner').count(),1)});
 await check('令牌不进入存储，离页清空；手机标识无横向溢出',async()=>{
  const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert.equal(stored.includes(token),false);
  await workbench.getByRole('button',{name:'清空本页凭据和记录'}).click();assert.equal(await workbench.getByLabel('本地 Bearer 令牌').inputValue(),'');
  await workbench.getByLabel('本地 Bearer 令牌').fill(token);await page.getByRole('navigation',{name:'主要导航'}).getByRole('link',{name:'首页与书架',exact:true}).click();await page.getByRole('button',{name:'打开独立后端联调',exact:true}).click();assert.equal(await page.locator('.backend-workbench').getByLabel('本地 Bearer 令牌').inputValue(),'');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.demo-mode-banner').isVisible(),true);
  fs.mkdirSync(path.join(root,'docs/screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'docs/screenshots/backend-workbench-390.png'),fullPage:true});
  await page.setViewportSize({width:1366,height:1000});await page.screenshot({path:path.join(root,'docs/screenshots/backend-workbench-1366.png'),fullPage:true});
 });
 await check('无前端脚本异常',async()=>assert.deepEqual(errors,[]));
 fs.writeFileSync(path.join(root,'docs/backend-integration-results.json'),JSON.stringify({date:'2026-11-05',backend:'A FastAPI actual implementation, isolated temporary database',browser:await browser.version(),checks,errors,scope:'真实 HTTP/认证/存储接口；没有真实模型或生产凭据'},null,2));
})().catch(error=>{console.error(String(error).replaceAll(token,'[redacted]').replaceAll(otherToken,'[redacted]'));process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(viteServer)await viteServer.close();if(backend)backend.kill()});
