import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ReadingWorkflowPanel from '../ReadingWorkflowPanel'
import { createApiClient } from '../../api/client'
import { ApiClient } from '../../lib/api'

describe('图文分析分镜与多页视频',()=>{
  it('首次渲染不自动调用收费服务',()=>{
    const api={workflow:vi.fn(),understandPages:vi.fn(),makeStoryboard:vi.fn(),saveStoryboard:vi.fn(),approveStoryboard:vi.fn(),generateBookVideo:vi.fn(),resumeBookVideo:vi.fn(),enableCloudInteractions:vi.fn(),cloudInteractionsEnabled:()=>false}
    const html=renderToStaticMarkup(<ReadingWorkflowPanel runId="r" pages={[{page_no:1}]} onReady={()=>{}} api={api}/> )
    expect(html).toContain('猫头鹰的故事工坊')
    expect(html).toContain('可选柔和女声配音')
    expect(api.understandPages).not.toHaveBeenCalled()
    expect(api.generateBookVideo).not.toHaveBeenCalled()
    expect(api.enableCloudInteractions).not.toHaveBeenCalled()
  })
  it('所有模型请求发给本人后端，带登录信息和独立授权',async()=>{
    const fetcher=vi.fn(async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}))
    const api=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'fixture-token',fetch:fetcher as typeof fetch})
    await api.workflow('r/1')
    await api.understandPages('r/1',[1,2])
    await api.makeStoryboard('r/1')
    await api.saveStoryboard('r/1',1,{character_guide:'乌龟',shots:[{page_no:1,caption:'走路',prompt:'温柔缓慢走路'}]})
    await api.approveStoryboard('r/1',2,true)
    await api.generateBookVideo('r/1')
    await api.resumeBookVideo('r/1')
    await api.semanticQuestion('r/1',{confirm_paid:true,query_text:'在哪里'})
    await api.semanticTouch('r/1',{confirm_paid:true,touch_point:{norm_x:.2,norm_y:.3}})
    const calls=fetcher.mock.calls as unknown as [string,RequestInit][]
    expect(calls.map(c=>c[0].split('/r%2F1/')[1])).toEqual(['workflow','workflow/vision','workflow/storyboard','workflow/storyboard','workflow/storyboard/approve','workflow/video','workflow/video/resume','interaction/qa','interaction/touch'])
    expect(calls.every(c=>new Headers(c[1].headers).get('Authorization')==='Bearer fixture-token')).toBe(true)
    expect(JSON.parse(calls[1][1].body as string)).toEqual({page_nos:[1,2],confirm_paid:true})
    expect(JSON.parse(calls[4][1].body as string)).toEqual({expected_revision:2,coverage_confirmed:true})
  })
  it('云端交互授权不跨账号，不自动保存到浏览器',()=>{
    const api=new ApiClient()
    expect(api.cloudInteractionsEnabled('r')).toBe(false)
    api.enableCloudInteractions('r',true)
    expect(api.cloudInteractionsEnabled('r')).toBe(true)
    expect(api.cloudInteractionsEnabled('other')).toBe(false)
    api.setToken('new-user-token')
    expect(api.cloudInteractionsEnabled('r')).toBe(false)
  })
})

it('生成记录只读请求使用本人凭据和编码后的书籍标识',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({records:[],amount:null}),{status:200}))
  const api=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'fixture',fetch:fetcher as typeof fetch})
  await api.generationRecords('b/1')
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][]
  expect(calls[0][0]).toBe('http://127.0.0.1:8000/api/books/b%2F1/generation-records')
  expect(new Headers(calls[0][1].headers).get('Authorization')).toBe('Bearer fixture')
  expect(calls[0][1].body).toBeUndefined()
})


it('提示词预览和外观建议仅查询本人服务器，不发送生成请求',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}))
  const api=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'fixture',fetch:fetcher as typeof fetch})
  await api.suggestCharacterGuide('r/1')
  await api.previewVideoPrompt('r/1',2)
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][]
  expect(calls.map(c=>c[0])).toEqual([
    'http://127.0.0.1:8000/api/runs/r%2F1/workflow/character-guide',
    'http://127.0.0.1:8000/api/runs/r%2F1/workflow/prompts/2',
  ])
  expect(calls.every(c=>!c[1].body&&new Headers(c[1].headers).get('Authorization')==='Bearer fixture')).toBe(true)
})
