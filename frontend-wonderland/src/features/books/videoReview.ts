import type { ReadingBook, RunVideoState } from '../../app/types'

export interface VideoReviewTarget {
  scope: string
  bookId: string
  serverBookId: string | null | undefined
  runId: string | null
  video: Extract<RunVideoState, {status:'ready'}>
}

/** 只复核当前账号、当前书与本次实际预览的已保存产物，过期页面的确认不能串书。 */
export function reviewSavedVideo(scope:string, book:ReadingBook, video:RunVideoState|undefined, target:VideoReviewTarget):ReadingBook|null {
  if(scope!==target.scope||book.id!==target.bookId||!book.server_book_id||book.server_book_id!==target.serverBookId||!book.run_id||book.run_id!==target.runId||video?.status!=='ready')return null
  if(!video.url||!video.asset_id||!video.sha256||video.asset_id!==target.video.asset_id||video.sha256!==target.video.sha256||video.url!==target.video.url)return null
  return {...book,status:'READY',safety_reviewed:true,pages_only:false}
}
