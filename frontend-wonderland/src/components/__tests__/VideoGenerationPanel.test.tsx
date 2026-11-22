import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import VideoGenerationPanel from '../VideoGenerationPanel'
import { createApiClient } from '../../api/client'

describe('独立视频生成',()=>{
  it('首次渲染只读取状态，不自动提交付费任务',()=>{
    const api={videoStatus:vi.fn(),generateVideo:vi.fn(),resumeVideo:vi.fn()}
    const html=renderToStaticMarkup(<VideoGenerationPanel runId="r" pages={[{page_no:1}]} onReady={()=>{}} api={api}/> )
    expect(html).toContain('让书页动起来')
    expect(html).toContain('不是全书视频，无配音')
    expect(html).not.toContain('确认并生成')
    expect(api.generateVideo).not.toHaveBeenCalled()
  })
  it('查询、确认提交和恢复接口使用本人登录凭据及独立地址',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({status:'QUEUED'}),{status:200,headers:{'Content-Type':'application/json'}}))
    const api=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'login-test-token',fetch:fetcher as typeof fetch})
    await api.videoStatus('r/1')
    await api.generateVideo('r/1',{page_no:2,prompt:'gentle',duration:5,confirm_paid:true})
    await api.resumeVideo('r/1')
    expect(fetcher.mock.calls.map((c:any)=>c[0])).toEqual(['http://127.0.0.1:8000/api/runs/r%2F1/video','http://127.0.0.1:8000/api/runs/r%2F1/video','http://127.0.0.1:8000/api/runs/r%2F1/video/resume'])
    const calls=fetcher.mock.calls as unknown as [string,RequestInit][]
    expect(new Headers(calls[1][1].headers).get('Authorization')).toBe('Bearer login-test-token')
    expect(JSON.parse(calls[1][1].body as string)).toEqual({page_no:2,prompt:'gentle',duration:5,confirm_paid:true})
    expect(calls[2][1].body).toBeUndefined()
  })
})
