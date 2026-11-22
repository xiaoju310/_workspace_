import { describe, expect, it } from 'vitest'
import { serverNoteDraft } from '../noteSync'
import type { BackendNoteOut } from '../../types/interaction'
describe('服务端阅读草稿',()=>{
  it('保留视觉分镜摘要及页码，不能变成旧 OCR 或自动分享',()=>{
    const out={id:'n',content:{title:'森林小路',summary:'乌龟走过小路。',concepts:['角色'],sources:[{page_no:2,source:'reviewed_storyboard',quote:'乌龟走路'}]},version:3,updated_at:'2026-11-16'} as unknown as BackendNoteOut
    const note=serverNoteDraft('b','备用标题',out)
    expect(note.summary).toBe('乌龟走过小路。')
    expect(note.title).toBe('森林小路')
    expect(note.sources).toEqual([{page_no:2,source:'script',quote:'乌龟走路',start_ms:null,end_ms:null}])
    expect(note.visibility).toBe('private')
    expect(note.review_status).toBe('draft')
    expect(note.revision).toBe(3)
  })
  it('空服务端结果不伪造摘要或来源',()=>{
    const note=serverNoteDraft('b','备用标题',{id:'n',content:{sources:[null,{page_no:0}]},version:1,updated_at:''} as unknown as BackendNoteOut)
    expect(note.title).toBe('备用标题')
    expect(note.summary).toBe('')
    expect(note.sources).toEqual([])
  })
})
