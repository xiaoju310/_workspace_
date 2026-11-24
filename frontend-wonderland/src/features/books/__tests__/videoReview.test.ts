import { describe, expect, it } from 'vitest'
import { initialBooks } from '../../../mock/workspace'
import { reviewSavedVideo } from '../videoReview'
import type { VideoReviewTarget } from '../videoReview'
import type { ReadingBook, RunVideoState } from '../../../app/types'
const book:ReadingBook={...initialBooks()[0],id:'book',server_book_id:'server-book',run_id:'run',safety_reviewed:false,status:'GENERATING',pages_only:true}
const video:Extract<RunVideoState,{status:'ready'}>={status:'ready',url:'blob:video',asset_id:'asset',sha256:'hash',size_bytes:123}
const target:VideoReviewTarget={scope:'account-a',bookId:book.id,serverBookId:book.server_book_id,runId:book.run_id,video}
describe('已保存视频复核仅限本次产物和账号',()=>{
  it('明确确认只修改复核状态，保留书页、运行和历史元数据且不原地修改',()=>{
    const result=reviewSavedVideo('account-a',book,video,target)
    expect(result).toEqual({...book,status:'READY',safety_reviewed:true,pages_only:false})
    expect(result?.pages).toBe(book.pages)
    expect(book.safety_reviewed).toBe(false)
  })
  it('拒绝其他账号或书、过期运行',()=>{
    expect(reviewSavedVideo('account-b',book,video,target)).toBeNull()
    for(const patch of [{id:'other'},{server_book_id:'other'},{server_book_id:null},{run_id:'other'},{run_id:null}]){
      expect(reviewSavedVideo('account-a',{...book,...patch},video,target)).toBeNull()
    }
  })
  it('拒绝被替换的产物、哈希及重新读取后的播放地址',()=>{
    for(const patch of [{asset_id:'new'},{sha256:'new'},{url:'blob:new'},{url:''}]){
      expect(reviewSavedVideo('account-a',book,{...video,...patch},target)).toBeNull()
    }
  })
  it.each([undefined,{status:'loading'},{status:'none',assetCount:1},{status:'error',error:'secret'}] as (RunVideoState|undefined)[])('没有真实已保存视频不能确认 %#',state=>{
    expect(reviewSavedVideo('account-a',book,state,target)).toBeNull()
  })
})
