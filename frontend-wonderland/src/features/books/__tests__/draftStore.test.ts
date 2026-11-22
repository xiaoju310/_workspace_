import { describe, expect, it, vi, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DraftStore } from '../draftStore'
import type { ImportDraft, WorkspaceDraft } from '../draftStore'
import { initialBooks } from '../../../mock/workspace'

const scope='live:user-a'
function setup(){const factory=new IDBFactory();return {factory,store:new DraftStore(factory,'test')}}
function draft(id='import-one'):ImportDraft{return {id,title:'我的书',authorizationRef:'原创',authorized:true,type:'picture_book',pages:[{id:'page-one',name:'1.png',size:3,url:'blob:old',file:new File(['abc'],'1.png',{type:'image/png'})}]}}
function workspace():WorkspaceDraft{return {books:initialBooks(),notes:[],grants:[],interactions:[]}}
afterEach(()=>vi.restoreAllMocks())

describe('持久草稿与原图',()=>{
 it('关闭连接后新实例恢复原始图片、字段与顺序，不复用失效的链接',async()=>{
  const {store,factory}=setup();const d=draft();d.pages.push({...d.pages[0],id:'page-two',name:'2.png',file:new File(['xyz'],'2.png',{type:'image/png'})});d.pages.reverse()
  await store.saveImport(scope,d)
  const restored=await new DraftStore(factory,'test').loadImport(scope,d.id)
  expect(restored?.pages.map(p=>p.name)).toEqual(['2.png','1.png']);expect(restored?.title).toBe(d.title);expect(restored?.authorized).toBe(true);expect(restored?.authorizationRef).toBe('原创')
  expect(restored?.pages[0].url).not.toBe('blob:old');expect(await restored?.pages[0].file?.text()).toBe('xyz')
  restored?.pages.forEach(p=>URL.revokeObjectURL(p.url))
 })
 it('用户及演示模式相互隔离，删除别人的同名草稿不会越权删除',async()=>{
  const {store}=setup();await store.saveImport(scope,draft());await store.saveImport('demo',draft())
  expect(await store.listImports('live:user-b')).toEqual([]);expect(await store.loadImport('live:user-b','import-one')).toBeNull()
  await store.deleteImport('live:user-b','import-one');expect(await store.listImports(scope)).toHaveLength(1);expect(await store.listImports('demo')).toHaveLength(1)
 })
 it('串行写入防止旧状态覆盖新输入，删除后不再出现',async()=>{
  const {store}=setup();await Promise.all([store.saveImport(scope,draft()),store.saveImport(scope,{...draft(),title:'最新标题'})])
  expect((await store.loadImport(scope,'import-one'))?.title).toBe('最新标题')
  await store.deleteImport(scope,'import-one');expect(await store.listImports(scope)).toEqual([])
 })
 it('成功转入书架后移除导入草稿，仍能恢复原图、页序、校对和未确认输入',async()=>{
  const {store}=setup();const d=draft();await store.saveImport(scope,d)
  const data=workspace();data.books[0].pages=[{id:'page-one',name:'1.png',image_url:'blob:no-longer-valid',ocr_text:'已保存原文',edit_text:'还没有点保存的修改',confidence:0.8,revision:2,confirmed:false,demo:false}]
  await store.saveWorkspace(scope,data,d.id)
  expect(await store.listImports(scope)).toEqual([])
  const result=await store.loadWorkspace(scope)
  expect(result?.data.books[0].pages[0].ocr_text).toBe('已保存原文');expect(result?.data.books[0].pages[0].edit_text).toBe('还没有点保存的修改')
  expect(await (await fetch(result!.data.books[0].pages[0].image_url)).text()).toBe('abc');result?.urls.forEach(URL.revokeObjectURL)
 })
 it('图片读取失败则保留旧书架和导入草稿，不假装导入成功',async()=>{
  const {store}=setup();await store.saveImport(scope,draft());await store.saveWorkspace(scope,workspace())
  const broken=workspace();broken.books[0].title='不应覆盖';broken.books[0].pages=[{...broken.books[0].pages[0],id:'missing',demo:false,image_url:'blob:missing'}]
  await expect(store.saveWorkspace(scope,broken,'import-one')).rejects.toThrow();expect(await store.listImports(scope)).toHaveLength(1)
  expect((await store.loadWorkspace(scope))?.data.books[0].title).not.toBe('不应覆盖')
 })
 it('存储空间不足时整个事务回滚，原草稿可恢复且后续重试有效',async()=>{
  const {store}=setup();await store.saveImport(scope,draft())
  const put=IDBObjectStorePrototype()
  const real=put.put
  const spy=vi.spyOn(put,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='records')throw new DOMException('空间不足','QuotaExceededError');return real.apply(this,args)})
  await expect(store.saveImport(scope,{...draft(),title:'失败标题'})).rejects.toThrow()
  spy.mockRestore();expect((await store.loadImport(scope,'import-one'))?.title).toBe('我的书')
  await store.saveImport(scope,{...draft(),title:'重试成功'});expect((await store.loadImport(scope,'import-one'))?.title).toBe('重试成功')
 })
 it('不支持 IndexedDB 时明确报错，不冒充已保存',async()=>{await expect(new DraftStore(undefined).saveImport(scope,draft())).rejects.toThrow('不支持')})
 it('可保存空图草稿、示例图；不会把导入草稿混入书架',async()=>{
  const {store}=setup();await store.saveImport(scope,{...draft(),title:'',pages:[]});expect((await store.listImports(scope))[0].title).toBe('未命名图书')
  await store.saveImport(scope,{...draft(),pages:[{id:'demo-1',name:'demo.svg',url:'/art/page.svg',size:0,demo:true}]})
  expect((await store.loadImport(scope,'import-one'))?.pages[0].url).toBe('/art/page.svg');expect(await store.loadWorkspace(scope)).toBeNull()
 })
 it('从删除入口不能误删书架',async()=>{const {store}=setup();await expect(store.deleteImport(scope,'workspace')).rejects.toThrow('不能')})
})
// 使用实现真实事务/回滚语义的测试数据库，不用总是成功的存储替身。
import { IDBObjectStore as FIDBObjectStore } from 'fake-indexeddb'
function IDBObjectStorePrototype(){return FIDBObjectStore.prototype}


describe('生词卡片本机保存',()=>{
 it('恢复生词、释义、来源与掌握状态，按账号隔离，删书时随书移除',async()=>{
  const {store,factory}=setup()
  const books=initialBooks()
  books[0].vocabulary=[{id:'word',word:'森林',meaning:'许多树',example:'',source:{page_no:1,source:'original_page',start_ms:null,end_ms:null,quote:'森林'},mastered:true,created_at:'today',updated_at:'today'}]
  const data={books,notes:[],grants:[],interactions:[]}
  await store.saveWorkspace(scope,data)
  const reopened=new DraftStore(factory,'test')
  expect((await reopened.loadWorkspace(scope))?.data.books[0].vocabulary).toEqual(books[0].vocabulary)
  expect(await reopened.loadWorkspace('another-user')).toBeNull()
  const {withoutBook}=await import('../deleteBook')
  await store.saveWorkspace(scope,withoutBook(data,books[0].id))
  expect((await reopened.loadWorkspace(scope))?.data.books.every(b=>!b.vocabulary?.length)).toBe(true)
 })
})


describe('书签持久化兼容性', () => {
 it('保存后重开恢复备注与稳定页ID，账号和演示模式隔离', async () => {
  const { store, factory } = setup(); const data = workspace()
  data.books[0].bookmarks = [{ id: 'bm', page_id: data.books[0].pages[1].id, note: '重读这一页', created_at: '2026-11-21T00:00:00Z', updated_at: '2026-11-21T00:00:00Z' }]
  await store.saveWorkspace(scope, data)
  const restored = await new DraftStore(factory, 'test').loadWorkspace(scope)
  expect(restored?.data.books[0].bookmarks).toEqual(data.books[0].bookmarks)
  expect(restored?.data.books[1].bookmarks ?? []).toEqual([])
  expect(await store.loadWorkspace('live:user-b')).toBeNull(); expect(await store.loadWorkspace('demo')).toBeNull()
  restored?.urls.forEach(URL.revokeObjectURL)
 })
 it('没有书签字段的旧草稿仍可恢复', async () => {
  const { store } = setup(); await store.saveWorkspace(scope, workspace())
  expect((await store.loadWorkspace(scope))?.data.books[0].bookmarks ?? []).toEqual([])
 })
})
