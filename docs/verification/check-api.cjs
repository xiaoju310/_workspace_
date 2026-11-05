const path=require('node:path');
const ts=require('typescript');const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../frontend/src/api/client.ts'),'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exportsObj={};let result={status:200,payload:{status:'ok'}},last;
const context={exports:exportsObj,URL,FormData,Blob,AbortController,DOMException,setTimeout,clearTimeout,fetch:async(url,init)=>{last={url,init};return new Response(JSON.stringify(result.payload),{status:result.status,headers:{'Content-Type':'application/json'}})}};
vm.runInNewContext(js,context);
(async()=>{
const client=exportsObj.createApiClient('http://localhost:8000/');assert.equal((await client.health()).status,'ok');assert.equal(last.url,'http://localhost:8000/health');
result={status:200,payload:{book_id:'b1'}};assert.equal((await client.createBook({title:'x',authorization_ref:'original'})).book_id,'b1');assert.equal(last.init.method,'POST');assert.equal(JSON.parse(last.init.body).title,'x');
await client.touch('run/a',{video_ms:1000,x_norm:.2,y_norm:.4,rendered_box:{width:800,height:450}});assert.equal(last.url,'http://localhost:8000/api/runs/run%2Fa/touches');
result={status:409,payload:{error:{code:'REVISION_CONFLICT',message:'版本已变化'}}};await assert.rejects(()=>client.updatePage('b','p',{ocr_text:'x',revision:1}),e=>e.status===409&&e.code==='REVISION_CONFLICT');
assert.throws(()=>exportsObj.createApiClient('file:///C:/bad'));assert.throws(()=>exportsObj.createApiClient('https://name:pass@example.com'));assert.throws(()=>exportsObj.createApiClient('https://example.com?key=bad'));
const report={date:'2026-11-04',checks:['健康检查路径','POST JSON输入','路径ID编码','409版本冲突传递','非法协议和凭据地址拒绝'],result:'PASS',mode:'用拦截 fetch 的本地单元验证，未连接真实服务'};fs.writeFileSync(path.resolve(__dirname,'../api-adapter-test.json'),JSON.stringify(report,null,2));console.log(report);
})().catch(e=>{console.error(e);process.exit(1)});
