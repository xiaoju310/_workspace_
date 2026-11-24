import { describe, it, expect, vi } from 'vitest'
import { ApiClient } from '../../../lib/api'
import { createApiClient } from '../../../api/client'
const params = {run_id:'r',video_ms:10,touch_point:{norm_x:.5,norm_y:.5,video_pixel_x:10,video_pixel_y:10,video_width:20,video_height:20},viewport_info:{}} as any
const frame={kind:'page_image' as const,page_no:1,snapshot:null}
function setup(fail=false){
  const calls:{url:string;body:any}[]=[]
  const fetcher=vi.fn(async(url:string,init:any)=>{
    const body=JSON.parse(init.body);calls.push({url,body})
    if(url.endsWith('/local-touch')&&fail)return new Response('{"detail":"本机未启动"}',{status:503})
    return new Response(JSON.stringify(url.endsWith('/local-touch')?{run_id:'r',video_ms:10,status:'success',target_name:'苹果',explanation:'这是苹果。',confidence:.9,evidence:null,latency_ms:10,cache_hit:false}:{id:'record'}),{status:200})
  })
  return {calls,api:new ApiClient({client:createApiClient('http://test',{getToken:()=> 'token',fetch:fetcher as any})})}
}
describe('本机千问识物',()=>{
  it('explicitly opts in locally and takes precedence over cloud consent',async()=>{
    const {api,calls}=setup();api.enableCloudInteractions('r',true);api.enableLocalInteractions('r',true)
    const result=await api.recognizeTouch(params,'live',{frame})
    expect(result.target_name).toBe('苹果')
    expect(calls[0].url).toContain('/local-touch')
    expect(calls[0].body).toMatchObject({confirm_local:true,confirm_paid:false,frame_kind:'page',current_page_no:1})
    expect(calls[1].body.output.recognition).toBe('local_qwen')
  })
  it('never falls back to paid calls when the local model fails',async()=>{
    const {api,calls}=setup(true);api.enableCloudInteractions('r',true);api.enableLocalInteractions('r',true)
    await expect(api.recognizeTouch(params,'live',{frame})).rejects.toThrow('本机未启动')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/local-touch')
  })
  it('clears local consent on account change',()=>{
    const {api}=setup();api.enableLocalInteractions('r',true);api.setToken('another')
    expect(api.localInteractionsEnabled('r')).toBe(false)
  })
})
