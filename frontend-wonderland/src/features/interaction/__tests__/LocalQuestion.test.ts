import {describe,it,expect,vi} from 'vitest'
import {ApiClient} from '../../../lib/api'
import {createApiClient} from '../../../api/client'
const params={book_id:'book',run_id:'r',video_ms:5,current_page_no:1,query_text:'她在做什么？'}
function setup(fail=false){
 const calls:{url:string;body:any}[]=[]
 const fetcher=vi.fn(async(url:string,init:any)=>{
  const body=JSON.parse(init.body);calls.push({url,body})
  if(url.endsWith('/local-qa')&&fail)return new Response('{"detail":"本机忙"}',{status:429})
  return new Response(JSON.stringify(url.endsWith('/local-qa')?{run_id:'r',question:params.query_text,answer:'她在搭积木。',status:'success',evidence:[],confidence:.9,latency:{total_roundtrip_ms:1},cache_hit:false}:{id:'record'}),{status:200})
 })
 return {calls,api:new ApiClient({client:createApiClient('http://test',{getToken:()=> 'token',fetch:fetcher as any}),modelServiceUrl:'http://never-call.invalid'})}
}
describe('本机千问问答',()=>{
 it('local consent wins over cloud and external service and records provenance',async()=>{
  const {api,calls}=setup();api.enableCloudInteractions('r',true);api.enableLocalInteractions('r',true);api.startReaderSession('r')
  const answer=await api.askQuestion(params,'live')
  expect(answer.answer_source).toBe('local_qwen');expect(answer.persisted).toBe(true)
  expect(calls[0].url).toContain('/local-qa')
  expect(calls[0].body).toMatchObject({confirm_local:true,confirm_paid:false,current_page_no:1,session_id:expect.any(String)})
  expect(calls[1].body.output.answer_source).toBe('local_qwen')
  expect(calls).toHaveLength(2)
 })
 it('never retries or falls back to paid requests on local failure',async()=>{
  const {api,calls}=setup(true);api.enableLocalInteractions('r',true);api.enableCloudInteractions('r',true)
  await expect(api.askQuestion(params,'live')).rejects.toThrow('本机忙')
  expect(calls).toHaveLength(1);expect(calls[0].body.confirm_paid).toBe(false)
 })
})
