import { initialBooks } from '../../../mock/workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DraftStore } from '../draftStore'
import { apiClient } from '../../../lib/api'
import { enableAccountSync, syncedScopes } from '../../../lib/accountDrafts'

const scope='sync-test:alice'
const workspace=()=>({books:[],notes:[],grants:[],interactions:[]})
const draft=()=>({id:'import-test',title:'旧设备草稿',authorizationRef:'原创',authorized:true,type:'picture_book' as const,pages:[]})
afterEach(()=>{syncedScopes.clear();apiClient.setToken('');vi.restoreAllMocks()})
function setup(){apiClient.setToken('alice');enableAccountSync(scope,true);return new DraftStore(new IDBFactory(),'sync')}
describe('跨设备账号草稿',()=>{
 it('先读取远端版本，保存带同一版本，另一个干净设备恢复更新',async()=>{
  const a=setup();let remote:any={revision:0,data:null}
  vi.spyOn(apiClient,'libraryDraft').mockImplementation(async()=>structuredClone(remote))
  vi.spyOn(apiClient,'libraryBooks').mockResolvedValue([])
  const write=vi.spyOn(apiClient,'saveLibraryDraft').mockImplementation(async(_key,rev,data)=>{expect(rev).toBe(remote.revision);remote={revision:rev+1,data:structuredClone(data)};return {revision:remote.revision}})
  await a.loadWorkspace(scope);await a.saveWorkspace(scope,workspace())
  const b=new DraftStore(new IDBFactory(),'second-device')
  expect((await b.loadWorkspace(scope))?.data.books).toEqual([])
  await b.saveWorkspace(scope,{...workspace(),notes:[{id:'note',summary:'另一个设备的笔记'} as any]})
  expect(write.mock.calls.map(c=>c[1])).toEqual([0,1])
  expect((await a.loadWorkspace(scope))?.data.notes[0].summary).toBe('另一个设备的笔记')
 })
 it('同步失败后先保存本机，重新登录不悄悄覆盖另一台设备的内容',async()=>{
  const a=setup();vi.spyOn(apiClient,'libraryDraft').mockResolvedValue({revision:9,data:{...workspace(),notes:[{summary:'远端更新'}]}})
  vi.spyOn(apiClient,'libraryBooks').mockResolvedValue([])
  const write=vi.spyOn(apiClient,'saveLibraryDraft').mockRejectedValue(new Error('409 conflict'))
  await expect(a.saveWorkspace(scope,{...workspace(),notes:[{summary:'本机没同步'} as any]})).rejects.toThrow('409')
  expect((await a.loadWorkspace(scope))?.data.notes[0].summary).toBe('本机没同步')
  await expect(a.saveWorkspace(scope,(await a.loadWorkspace(scope))!.data)).rejects.toThrow('409')
  expect(write.mock.calls.every(c=>c[1]===0)).toBe(true)
 })
 it('旧账号排队任务在账号切换后不会把草稿传给新账号',async()=>{
  const a=setup();const write=vi.spyOn(apiClient,'saveLibraryDraft')
  apiClient.setToken('bob')
  await expect(a.saveWorkspace(scope,workspace())).rejects.toThrow('账号已切换')
  expect(write).not.toHaveBeenCalled()
 })
 it('旧版只有本机的导入草稿也会迁移',async()=>{
  const a=new DraftStore(new IDBFactory(),'legacy')
  await a.saveImport(scope,draft())
  apiClient.setToken('alice');enableAccountSync(scope,true)
  const write=vi.spyOn(apiClient,'saveLibraryDraft').mockResolvedValue({revision:1})
  await a.syncPendingImports(scope)
  expect(write).toHaveBeenCalledWith('import-test',0,draft())
 })
 it('先上传原图再提交元数据，换设备取回字节并重建预览',async()=>{
  const a=setup();const blob=new Blob(['original-bytes'],{type:'image/png'})
  const old=URL.createObjectURL(blob)
  let remote:any={revision:0,data:null};const order:string[]=[]
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(blob))
  vi.spyOn(apiClient,'uploadLibraryImage').mockImplementation(async()=>{order.push('image');return {sha256:'hash'}})
  vi.spyOn(apiClient,'libraryImage').mockResolvedValue(blob)
  vi.spyOn(apiClient,'libraryDraft').mockImplementation(async()=>structuredClone(remote))
  vi.spyOn(apiClient,'saveLibraryDraft').mockImplementation(async(_k,_r,data)=>{order.push('metadata');remote={revision:1,data};return {revision:1}})
  await a.saveImport(scope,{...draft(),pages:[{id:'page',name:'1.png',size:blob.size,url:old,file:new File([blob],'1.png',{type:blob.type})}]})
  expect(order).toEqual(['image','metadata']);expect(remote.data.pages[0].url).toBe('');expect(remote.data.pages[0].file).toBeUndefined()
  const b=new DraftStore(new IDBFactory(),'other')
  const loaded=await b.loadImport(scope,'import-test')
  expect(loaded?.pages[0].url).not.toBe(old)
  expect(await loaded?.pages[0].file?.text()).toBe('original-bytes')
 })
})


describe('账号草稿保存阅读位置',()=>{
 it('远端打包保留页码/视频标识，新设备恢复，临时播放地址不持久化',async()=>{
  const a=setup();let remote:any={revision:0,data:null}
  vi.spyOn(apiClient,'libraryDraft').mockImplementation(async()=>structuredClone(remote))
  vi.spyOn(apiClient,'libraryBooks').mockResolvedValue([])
  vi.spyOn(apiClient,'saveLibraryDraft').mockImplementation(async(_key,rev,data)=>{remote={revision:rev+1,data:structuredClone(data)};return {revision:remote.revision}})
  const data={...workspace(),books:initialBooks()}
  const position={time_ms:52000,page_index:1,video:true,run_id:data.books[0].run_id,video_key:'asset:hash',updated_at:'2026-11-19T12:00:00Z'}
  data.books[0].reading_position=position;data.books[0].video_url='blob:temporary'
  await a.loadWorkspace(scope);await a.saveWorkspace(scope,data)
  expect(remote.data.books[0].reading_position).toEqual(position)
  expect(remote.data.books[0].video_url).toBeNull()
  const b=new DraftStore(new IDBFactory(),'reading-new-device')
  expect((await b.loadWorkspace(scope))?.data.books[0].reading_position).toEqual(position)
 })
})


describe('生词卡片账号草稿',()=>{
 it('随图书保存、远端打包、新设备恢复；其他书无生词不受影响',async()=>{
  const a=setup();let remote:any={revision:0,data:null}
  vi.spyOn(apiClient,'libraryDraft').mockImplementation(async()=>structuredClone(remote))
  vi.spyOn(apiClient,'libraryBooks').mockResolvedValue([])
  vi.spyOn(apiClient,'saveLibraryDraft').mockImplementation(async(_key,rev,data)=>{remote={revision:rev+1,data:structuredClone(data)};return {revision:remote.revision}})
  const data={...workspace(),books:initialBooks()}
  const cards=[{id:'word-1',word:'森林',meaning:'许多树生长的地方',example:'森林里有小兔子',source:{page_no:2,start_ms:null,end_ms:null,source:'original_page' as const,quote:'森林'},mastered:true,created_at:'2026-11-19',updated_at:'2026-11-19'}]
  data.books[0].vocabulary=cards
  await a.loadWorkspace(scope);await a.saveWorkspace(scope,data)
  expect(remote.data.books[0].vocabulary).toEqual(cards)
  const b=new DraftStore(new IDBFactory(),'vocabulary-new-device')
  const restored=(await b.loadWorkspace(scope))!.data
  expect(restored.books[0].vocabulary).toEqual(cards)
  expect(restored.books[1].vocabulary).toBeUndefined()
 })
})


describe('书签跨设备草稿', () => {
 it('真实草稿同步链路保留书签并在另一设备恢复', async () => {
  const a = setup(); let remote: any = { revision: 0, data: null }
  vi.spyOn(apiClient, 'libraryDraft').mockImplementation(async () => structuredClone(remote))
  vi.spyOn(apiClient, 'libraryBooks').mockResolvedValue([])
  vi.spyOn(apiClient, 'saveLibraryDraft').mockImplementation(async (_key, rev, data) => { remote = { revision: rev + 1, data: structuredClone(data) }; return { revision: remote.revision } })
  const books = initialBooks()
  books[0].bookmarks = [{ id: 'bm', page_id: books[0].pages[1].id, note: '账号书签', created_at: '2026-11-21T00:00:00Z', updated_at: '2026-11-21T00:00:00Z' }]
  await a.loadWorkspace(scope); await a.saveWorkspace(scope, { ...workspace(), books })
  const b = new DraftStore(new IDBFactory(), 'bookmark-device')
  const restored = await b.loadWorkspace(scope)
  expect(restored?.data.books[0].bookmarks).toEqual(books[0].bookmarks)
  restored?.urls.forEach(URL.revokeObjectURL)
 })
})
