import { describe, it, expect, vi } from 'vitest'
import { createApiClient } from '../../../api/client'
import { buildVoiceInput } from '../../../lib/api'

describe('本机语音与配音契约',()=>{
  it('配音选项只随主人主动请求发送，默认为关闭',async()=>{
    const fetcher=vi.fn(async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}))
    const api=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'test',fetch:fetcher as typeof fetch})
    expect(fetcher).not.toHaveBeenCalled()
    await api.generateBookVideo('run')
    await api.generateBookVideo('run',true)
    const calls=fetcher.mock.calls as unknown as [string,RequestInit][]
    expect(JSON.parse(calls[0][1].body as string)).toEqual({confirm_paid:true,narration:false})
    expect(JSON.parse(calls[1][1].body as string)).toEqual({confirm_paid:true,narration:true})
  })
  it('录音只上传到登录服务器，独立同意，不保存到云端模型',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({text:'小乌龟',provider:'windows_system_speech',audio_storage:'temporary_deleted'}),{headers:{'Content-Type':'application/json'}}))
    const api=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'test',fetch:fetcher as typeof fetch})
    const audio=new Blob(['wav'],{type:'audio/wav'})
    const data=await api.transcribeAudio(audio)
    const [url,init]=(fetcher.mock.calls as unknown as [string,RequestInit][])[0]
    expect(url).toBe('http://127.0.0.1:8000/api/speech/transcribe')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test')
    expect(new Headers(init.headers).get('X-Local-Speech-Consent')).toBe('true')
    expect(init.body).toBe(audio)
    expect(data.provider).toBe('windows_system_speech')
  })
  it('离开页面可以取消兜底，取消后不会等待识别完成',async()=>{
    let active:AbortSignal|undefined
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      active=init?.signal??undefined
      return await new Promise<Response>((_resolve,reject)=>active?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
    })
    const api=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'test',fetch:fetcher as typeof fetch})
    const controller=new AbortController()
    const pending=api.transcribeAudio(new Blob(['wav'],{type:'audio/wav'}),controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(active?.aborted).toBe(true)
  })
  it('留痕如实记录兜底来源、临时删除和主人修改',async()=>{
    const input=await buildVoiceInput(new Blob(['wav'],{type:'audio/wav'}),{
      mimeType:'audio/wav',durationMs:1000,transcript:'乌龟',transcriptIsFinal:true,
      asrProvider:'windows_system_speech',audioStorage:'temporary_deleted'},'乌龟在哪里')
    expect(input.asr_provider).toBe('windows_system_speech')
    expect(input.audio?.storage).toBe('browser_only')
    expect(input.audio?.server_processing).toBe('temporary_deleted')
    expect(input.transcript_edited).toBe(true)
  })
})
