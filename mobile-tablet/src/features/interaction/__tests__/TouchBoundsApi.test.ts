import { describe, it, expect, vi } from 'vitest'
import { ApiClient } from '../../../lib/api'
import { createApiClient } from '../../../api/client'
const req = {book_id:'b',run_id:'r',video_ms:3000,touch_point:{norm_x:.25,norm_y:.5,video_pixel_x:200,video_pixel_y:300,video_width:800,video_height:600},viewport_info:{container_width:800,container_height:600,render_width:800,render_height:600,offset_x:0,offset_y:0,is_letterbox:false}}
function setup(box:unknown=[.1,.2,.4,.8], status='success') {
  const calls:{url:string;body:any}[]=[]
  const fetcher=vi.fn(async(url:string,init:any)=>{
    calls.push({url,body:JSON.parse(init.body)})
    return new Response(JSON.stringify(url.endsWith('/interaction/touch') ? {status,target_name:'黄瓜',explanation:'绿色蔬菜',confidence:.9,bounding_box:box,evidence:null} : {id:'i'}),{status:200})
  })
  return {calls,api:new ApiClient({client:createApiClient('http://test',{getToken:()=> 'token',fetch:fetcher as any})})}
}
const frame={kind:'page_image' as const,page_no:2,snapshot:null}
describe('带物体框的已授权识物接口',()=>{
  it('propagates and records valid geometry',async()=>{
    const {api,calls}=setup();api.enableCloudInteractions('r',true)
    const result=await api.recognizeTouch(req,'live',{frame})
    expect(result.bounding_box).toEqual([.1,.2,.4,.8])
    expect(calls[0].url).toBe('http://test/api/runs/r/interaction/touch')
    expect(calls[0].body).toMatchObject({current_page_no:2,frame_kind:'page',confirm_paid:true})
    expect(calls[1].body.output.bounding_box).toEqual([.1,.2,.4,.8])
  })
  it.each([[[.7,0,1,1]],[[-1,0,1,1]],[[.1,.2,.1,.8]]])('does not persist invalid geometry %j',async box=>{
    const {api,calls}=setup(box);api.enableCloudInteractions('r',true)
    expect((await api.recognizeTouch(req,'live',{frame})).bounding_box).toBeUndefined()
    expect(calls[1].body.output.bounding_box).toBeNull()
  })
  it('locks video identification to the captured time and registered video asset',async()=>{
    const {api,calls}=setup();api.enableCloudInteractions('r',true)
    await api.recognizeTouch(req,'live',{frame:{kind:'video',page_no:2,snapshot:new Blob(['frame']),frame_time_ms:3123,asset_id:'asset',asset_sha256:'hash'}})
    expect(calls[0].body).toMatchObject({video_ms:3123,frame_kind:'video',asset_id:'asset',asset_sha256:'hash',frame_image_base64:btoa('frame')})
  })
  it('uncertain results never expose a model box',async()=>{
    const {api,calls}=setup([.1,.2,.4,.8],'uncertain');api.enableCloudInteractions('r',true)
    expect((await api.recognizeTouch(req,'live',{frame})).bounding_box).toBeUndefined()
    expect(calls[1].body.output.bounding_box).toBeNull()
  })
  it('requires manual authorization and clears it on login change',async()=>{
    const {api,calls}=setup();const listener=vi.fn();api.subscribeCloudInteractions(listener)
    expect((await api.recognizeTouch(req,'live',{frame})).status).toBe('uncertain')
    expect(calls.some(c=>c.url.endsWith('/interaction/touch'))).toBe(false)
    api.enableCloudInteractions('r',true);api.setToken('other')
    expect(api.cloudInteractionsEnabled('r')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })
  it('does not send a screenshot to an old external model URL without consent',async()=>{
    const external=vi.fn();const transport=createApiClient('http://test',{getToken:()=> 'token',fetch:(async()=>new Response('{"id":"i"}',{status:200})) as any})
    const api=new ApiClient({client:transport,modelServiceUrl:'https://old-model.invalid',fetchImpl:external})
    expect((await api.recognizeTouch(req,'live',{frame})).status).toBe('uncertain')
    expect(external).not.toHaveBeenCalled()
  })
})
